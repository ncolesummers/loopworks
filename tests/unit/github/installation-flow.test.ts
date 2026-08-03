/** @vitest-environment node */

import {
  createGithubInstallationFlow,
  type GithubInstallationChallenge,
  type GithubInstallationGateway,
  type GithubInstallationStore,
} from "@/lib/github/installation-flow";

function createHarness() {
  const challenges = new Map<string, GithubInstallationChallenge>();
  const connected: Array<{ installationId: number; installedBy: string }> = [];
  const secrets = ["install-state", "oauth-state", "pkce-verifier"];
  const store: GithubInstallationStore = {
    async connectInstallation(input) {
      if (connected.some((row) => row.installationId === input.installationId)) {
        return "already-connected";
      }
      connected.push({ installationId: input.installationId, installedBy: input.installedBy });
      return "connected";
    },
    async consumeChallenge(input) {
      const challenge = challenges.get(input.stateDigest);
      if (
        !challenge ||
        challenge.actorId !== input.actorId ||
        challenge.phase !== input.phase ||
        challenge.consumedAt ||
        challenge.expiresAt <= input.now
      ) {
        return null;
      }
      challenge.consumedAt = input.now;
      return challenge;
    },
    async createChallenge(input) {
      const challenge = {
        ...input,
        consumedAt: null,
      } satisfies GithubInstallationChallenge;
      challenges.set(input.stateDigest, challenge);
      return challenge;
    },
  };
  const gateway: GithubInstallationGateway = {
    async exchangeUserCode() {
      return "ghu_transient_user_token";
    },
    async getAuthenticatedUserLogin() {
      return "ncolesummers";
    },
    async userCanAccessInstallation() {
      return true;
    },
    async verifyAppInstallation() {
      return {
        accountId: 12_400,
        accountLogin: "loopworks-org",
        accountType: "Organization",
        appId: 124,
        installationId: 124_001,
        repositorySelection: "selected",
      };
    },
  };
  const flow = createGithubInstallationFlow({
    config: {
      appId: 124,
      callbackUrl: "https://loopworks.example/api/github/install/callback",
      clientId: "Iv1.loopworks",
      clientSecret: "github-app-client-secret",
      slug: "loopworks-app",
    },
    gateway,
    generateSecret: () => secrets.shift() ?? "extra-secret",
    now: () => new Date("2026-08-03T04:00:00.000Z"),
    store,
  });

  return { challenges, connected, flow, gateway };
}

describe("GitHub App installation flow", () => {
  it("starts with opaque actor-bound state and the configured app slug", async () => {
    const { challenges, flow } = createHarness();

    const result = await flow.start({ actorId: "ncolesummers" });

    expect(result.location).toBe(
      "https://github.com/apps/loopworks-app/installations/new?state=install-state",
    );
    expect([...challenges.values()]).toEqual([
      expect.objectContaining({
        actorId: "ncolesummers",
        phase: "installation",
        installationId: undefined,
        expiresAt: new Date("2026-08-03T04:10:00.000Z"),
      }),
    ]);
    expect(JSON.stringify([...challenges.values()])).not.toContain("install-state");
  });

  it("verifies the setup return and starts user authorization with state and PKCE", async () => {
    const { flow } = createHarness();
    await flow.start({ actorId: "ncolesummers" });

    const result = await flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });

    expect(result).toMatchObject({
      kind: "authorize",
      verifierCookie: "pkce-verifier",
    });
    if (result.kind !== "authorize") throw new Error("Expected authorization redirect.");
    const url = new URL(result.location);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.loopworks");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://loopworks.example/api/github/install/callback",
    );
    expect(url.searchParams.get("state")).toBe("oauth-state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe("pkce-verifier");
  });

  it("rejects forged, cross-actor, wrong-app, and replayed setup callbacks without connecting", async () => {
    const { connected, flow, gateway } = createHarness();
    await flow.start({ actorId: "ncolesummers" });

    await expect(
      flow.callback({
        actorId: "somebody-else",
        authorizationCode: null,
        error: null,
        installationId: "124001",
        pkceVerifier: null,
        setupAction: "install",
        githubInstallationState: "install-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    vi.spyOn(gateway, "verifyAppInstallation").mockResolvedValueOnce({
      accountId: 12_400,
      accountLogin: "loopworks-org",
      accountType: "Organization",
      appId: 999,
      installationId: 124_001,
      repositorySelection: "selected",
    });
    await expect(
      flow.callback({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: null,
        installationId: "124001",
        pkceVerifier: null,
        setupAction: "install",
        githubInstallationState: "install-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    await expect(
      flow.callback({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: null,
        installationId: "124001",
        pkceVerifier: null,
        setupAction: "install",
        githubInstallationState: "install-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });
    expect(connected).toEqual([]);
  });

  it("persists only after the user token matches the session and can access the installation", async () => {
    const { connected, flow } = createHarness();
    await flow.start({ actorId: "ncolesummers" });
    await flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });

    await expect(
      flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "one-time-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "connected" });
    expect(connected).toEqual([{ installationId: 124_001, installedBy: "ncolesummers" }]);
  });

  it("handles pending approval, cancellation, and a fresh duplicate distinctly", async () => {
    const pending = createHarness();
    await pending.flow.start({ actorId: "ncolesummers" });
    await expect(
      pending.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: null,
        installationId: null,
        pkceVerifier: null,
        setupAction: "request",
        githubInstallationState: "install-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "pending-approval" });

    const cancelled = createHarness();
    await cancelled.flow.start({ actorId: "ncolesummers" });
    await expect(
      cancelled.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: null,
        installationId: null,
        pkceVerifier: null,
        setupAction: null,
        githubInstallationState: "install-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "cancelled" });

    const duplicate = createHarness();
    await duplicate.flow.start({ actorId: "ncolesummers" });
    await duplicate.flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await duplicate.flow.callback({
      actorId: "ncolesummers",
      authorizationCode: "first-code",
      error: null,
      installationId: null,
      pkceVerifier: "pkce-verifier",
      setupAction: null,
      githubInstallationState: "oauth-state",
    });
    const second = createHarness();
    second.connected.push(...duplicate.connected);
    await second.flow.start({ actorId: "another-operator" });
    await second.flow.callback({
      actorId: "another-operator",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    vi.spyOn(second.gateway, "getAuthenticatedUserLogin").mockResolvedValue("another-operator");
    await expect(
      second.flow.callback({
        actorId: "another-operator",
        authorizationCode: "second-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "already-connected" });
    expect(second.connected).toEqual([{ installationId: 124_001, installedBy: "ncolesummers" }]);
  });

  it("rejects authorization denial, login mismatch, inaccessible installation, and replay", async () => {
    const denied = createHarness();
    await denied.flow.start({ actorId: "ncolesummers" });
    await denied.flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await expect(
      denied.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: null,
        error: "access_denied",
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "cancelled" });
    await expect(
      denied.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "replayed-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    const mismatched = createHarness();
    vi.spyOn(mismatched.gateway, "getAuthenticatedUserLogin").mockResolvedValue("attacker");
    await mismatched.flow.start({ actorId: "ncolesummers" });
    await mismatched.flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await expect(
      mismatched.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    const inaccessible = createHarness();
    vi.spyOn(inaccessible.gateway, "userCanAccessInstallation").mockResolvedValue(false);
    await inaccessible.flow.start({ actorId: "ncolesummers" });
    await inaccessible.flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await expect(
      inaccessible.flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });
  });
});
