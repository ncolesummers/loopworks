/** @vitest-environment node */

import { SpanStatusCode } from "@opentelemetry/api";

import {
  getGithubInstallationCallbackPhase,
  handleGithubInstallationCallback,
  runGithubInstallationCallbackRoute,
} from "@/app/api/github/install/callback/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GitHub App installation callback route", () => {
  function recordingSpan() {
    return {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
    };
  }

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
    expect(
      getGithubInstallationCallbackPhase(
        new Request(
          "https://loopworks.local/api/github/install/callback?code=&installation_id=124001",
        ),
      ),
    ).toBe("installation");
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
    const span = recordingSpan();
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
        span: span as never,
      },
    );

    expect(response.headers.get("location")).toBe(
      "https://loopworks.local/settings?github=connected",
    );
    expect(response.headers.get("location")).not.toContain("secret");
    expect(response.headers.get("set-cookie")).toContain("loopworks-github-install-pkce=");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970");
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.phase",
      "authorization",
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "connected",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it("marks a flow-level error outcome as an error span", async () => {
    const span = recordingSpan();
    const response = await handleGithubInstallationCallback(
      new Request("https://loopworks.local/api/github/install/callback?state=invalid"),
      {
        processCallback: async () => ({ kind: "settings", outcome: "error" }),
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        span: span as never,
      },
    );

    expect(response.headers.get("location")).toBe("https://loopworks.local/settings?github=error");
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.phase",
      "installation",
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "error",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
  });

  it("marks a caught callback failure as an error without recording the exception", async () => {
    const span = recordingSpan();
    const response = await handleGithubInstallationCallback(
      new Request("https://loopworks.local/api/github/install/callback?state=opaque"),
      {
        processCallback: async () => {
          throw new Error("sensitive provider failure");
        },
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        span: span as never,
      },
    );

    expect(response.headers.get("location")).toBe("https://loopworks.local/settings?github=error");
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span).not.toHaveProperty("recordException");
  });

  it("does not initialize callback processing before the existing session gate", async () => {
    const processCallback = vi.fn();
    const span = recordingSpan();
    const response = await handleGithubInstallationCallback(
      new Request("https://loopworks.local/api/github/install/callback?state=forged"),
      {
        processCallback,
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
        span: span as never,
      },
    );

    expect(response.status).toBe(401);
    expect(processCallback).not.toHaveBeenCalled();
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "unauthenticated",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
  });

  it("passes the owned route span into the callback handler and ends it", async () => {
    const span = recordingSpan();
    const handleCallback = vi.fn(async (_request: Request, dependencies?: { span?: unknown }) => {
      expect(dependencies?.span).toBe(span);
      return new Response(null, { status: 204 }) as never;
    });
    const withSpan = vi.fn(
      async (_name: string, callback: (ownedSpan: never) => Promise<unknown>) =>
        callback(span as never),
    );

    const response = await runGithubInstallationCallbackRoute(
      new Request("https://loopworks.local/api/github/install/callback"),
      { handleCallback: handleCallback as never, withSpan: withSpan as never },
    );

    expect(response.status).toBe(204);
    expect(withSpan).toHaveBeenCalledWith("github.installation.callback", expect.any(Function));
    expect(span.end).toHaveBeenCalledOnce();
  });
});
