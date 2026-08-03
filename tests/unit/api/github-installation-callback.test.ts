/** @vitest-environment node */

import {
  getGithubInstallationCallbackPhase,
  handleGithubInstallationCallback,
} from "@/app/api/github/install/callback/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GitHub App installation callback route", () => {
  it("classifies setup and user-authorization callback telemetry", () => {
    expect(
      getGithubInstallationCallbackPhase(
        new Request("https://loopworks.local/api/github/install/callback?state=setup"),
      ),
    ).toBe("installation");
    expect(
      getGithubInstallationCallbackPhase(
        new Request("https://loopworks.local/api/github/install/callback?error=access_denied"),
      ),
    ).toBe("authorization");
  });

  it("sends a valid setup return into GitHub App user authorization before persistence", async () => {
    const processCallback = vi.fn(async () => ({
      kind: "authorize" as const,
      location:
        "https://github.com/login/oauth/authorize?client_id=github-app-client&state=oauth-state&code_challenge=challenge&code_challenge_method=S256",
      verifierCookie: "pkce-verifier",
    }));

    const response = await handleGithubInstallationCallback(
      new Request(
        "https://loopworks.local/api/github/install/callback?installation_id=124001&setup_action=install&state=install-state",
      ),
      {
        processCallback,
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
      },
    );

    expect(processCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: null,
        installationId: "124001",
        setupAction: "install",
        githubInstallationState: "install-state",
      }),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("https://github.com/login/oauth/authorize");
    expect(response.headers.get("set-cookie")).toContain("loopworks-github-install-pkce");
  });

  it("clears transient PKCE material and redirects only a stable outcome to Settings", async () => {
    const response = await handleGithubInstallationCallback(
      new Request(
        "https://loopworks.local/api/github/install/callback?code=secret-code&state=secret-state",
        { headers: { cookie: "loopworks-github-install-pkce=secret-verifier" } },
      ),
      {
        processCallback: async (input) => {
          expect(input.pkceVerifier).toBe("secret-verifier");
          return { kind: "settings", outcome: "connected" };
        },
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
      },
    );

    expect(response.headers.get("location")).toBe(
      "https://loopworks.local/settings?github=connected",
    );
    expect(response.headers.get("location")).not.toContain("secret");
    expect(response.headers.get("set-cookie")).toContain("loopworks-github-install-pkce=");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("does not initialize callback processing before the existing session gate", async () => {
    const processCallback = vi.fn();
    const response = await handleGithubInstallationCallback(
      new Request("https://loopworks.local/api/github/install/callback?state=forged"),
      {
        processCallback,
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(processCallback).not.toHaveBeenCalled();
  });
});
