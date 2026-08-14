/** @vitest-environment node */

import {
  createGithubInstallationFlow,
  type GithubInstallationChallenge,
  type GithubInstallationGateway,
  type GithubInstallationStore,
} from "@/lib/github/installation-flow";

function createHarness(options: { secrets?: string[] } = {}) {
  const challenges = new Map<string, GithubInstallationChallenge>();
  const connected: Array<{ installationId: number; installedBy: string }> = [];
  const secrets = options.secrets ?? ["install-state", "oauth-state", "pkce-verifier"];
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
    async hasConnectedInstallation() {
      return connected.length > 0;
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
    async getAuthenticatedUserProviderAccountId() {
      return "22808397";
    },
    async listInstallationRepositories() {
      return [];
    },
    async listUserInstallations() {
      return [{ appId: 124, installationId: 124_001 }];
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

  return { challenges, connected, flow, gateway, store };
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
      mode: "github",
      githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
      mode: "github",
      githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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

  it("accepts a renamed GitHub login when the immutable provider account id still matches", async () => {
    const { connected, flow } = createHarness();
    await flow.start({ actorId: "historical-login" });
    await flow.callback({
      actorId: "historical-login",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
      mode: "github",
      githubProviderAccountId: "22808397",
    });
    await expect(
      flow.callback({
        actorId: "historical-login",
        authorizationCode: "one-time-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
        mode: "github",
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "connected" });
    expect(connected).toEqual([{ installationId: 124_001, installedBy: "historical-login" }]);
  });

  it("rejects a different provider account that presents the historical login before access or writes", async () => {
    const { connected, flow, gateway } = createHarness();
    Object.assign(gateway, {
      getAuthenticatedUserProviderAccountId: vi.fn(async () => "99900001"),
    });
    const canAccess = vi.spyOn(gateway, "userCanAccessInstallation");
    const verifyInstallation = vi.spyOn(gateway, "verifyAppInstallation");
    await flow.start({ actorId: "ncolesummers" });
    await flow.callback({
      actorId: "ncolesummers",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
      mode: "github",
      githubProviderAccountId: "22808397",
    });
    canAccess.mockClear();
    verifyInstallation.mockClear();

    await expect(
      flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "one-time-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
        mode: "github",
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });
    expect(canAccess).not.toHaveBeenCalled();
    expect(verifyInstallation).not.toHaveBeenCalled();
    expect(connected).toEqual([]);
  });

  it("keeps the explicit local fixture bypass independent of database provider identity", async () => {
    const { connected, flow, gateway } = createHarness();
    Object.assign(gateway, {
      getAuthenticatedUserProviderAccountId: vi.fn(async () => "99900001"),
    });
    await flow.start({ actorId: "local-fixture" });
    await flow.callback({
      actorId: "local-fixture",
      authorizationCode: null,
      error: null,
      githubInstallationState: "install-state",
      githubProviderAccountId: null,
      installationId: "124001",
      mode: "fixture",
      pkceVerifier: null,
      setupAction: "install",
    });

    await expect(
      flow.callback({
        actorId: "local-fixture",
        authorizationCode: "one-time-code",
        error: null,
        githubInstallationState: "oauth-state",
        githubProviderAccountId: null,
        installationId: null,
        mode: "fixture",
        pkceVerifier: "pkce-verifier",
        setupAction: null,
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "connected" });
    expect(connected).toEqual([{ installationId: 124_001, installedBy: "local-fixture" }]);
  });

  it("handles pending approval, cancellation, and a fresh duplicate distinctly", async () => {
    const pending = createHarness();
    await pending.flow.start({ actorId: "ncolesummers" });
    await expect(
      pending.flow.callback({
        actorId: "ncolesummers",
        mode: "github",
        githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
      mode: "github",
      githubProviderAccountId: "22808397",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await duplicate.flow.callback({
      actorId: "ncolesummers",
      mode: "github",
      githubProviderAccountId: "22808397",
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
      mode: "github",
      githubProviderAccountId: "22808397",
      authorizationCode: null,
      error: null,
      installationId: "124001",
      pkceVerifier: null,
      setupAction: "install",
      githubInstallationState: "install-state",
    });
    await expect(
      second.flow.callback({
        actorId: "another-operator",
        mode: "github",
        githubProviderAccountId: "22808397",
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
      mode: "github",
      githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
        authorizationCode: "replayed-code",
        error: null,
        installationId: null,
        pkceVerifier: "pkce-verifier",
        setupAction: null,
        githubInstallationState: "oauth-state",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    const mismatched = createHarness();
    vi.spyOn(mismatched.gateway, "getAuthenticatedUserProviderAccountId").mockResolvedValue(
      "99900001",
    );
    await mismatched.flow.start({ actorId: "ncolesummers" });
    await mismatched.flow.callback({
      actorId: "ncolesummers",
      mode: "github",
      githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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
      mode: "github",
      githubProviderAccountId: "22808397",
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
        mode: "github",
        githubProviderAccountId: "22808397",
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

/**
 * GitHub only installs from `/apps/<slug>/installations/new` when an eligible
 * target does not already have the App. When the only eligible account already
 * has it, GitHub short-circuits to the configure page and never calls the Setup
 * URL, so the installation phase can never run for that operator (#151).
 * Reconciliation is the operator-initiated entry into the same authorization
 * phase, distinguished by an authorization challenge with no candidate
 * installation.
 */
describe("GitHub App installation reconciliation", () => {
  function createReconcileHarness() {
    return createHarness({ secrets: ["reconcile-state", "reconcile-verifier"] });
  }

  async function reconcileCallback(
    flow: ReturnType<typeof createHarness>["flow"],
    overrides: Partial<{
      actorId: string;
      authorizationCode: string | null;
      error: string | null;
      pkceVerifier: string | null;
      githubInstallationState: string | null;
    }> = {},
  ) {
    return flow.callback({
      actorId: "ncolesummers",
      mode: "github",
      githubProviderAccountId: "22808397",
      authorizationCode: "one-time-code",
      error: null,
      installationId: null,
      pkceVerifier: "reconcile-verifier",
      setupAction: null,
      githubInstallationState: "reconcile-state",
      ...overrides,
    });
  }

  it("starts an unbound authorization challenge with fresh state and PKCE", async () => {
    const { challenges, flow } = createReconcileHarness();

    const result = await flow.startReconciliation({ actorId: "ncolesummers" });

    expect(result.verifierCookie).toBe("reconcile-verifier");
    const url = new URL(result.location);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("Iv1.loopworks");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://loopworks.example/api/github/install/callback",
    );
    expect(url.searchParams.get("state")).toBe("reconcile-state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe("reconcile-verifier");
    expect([...challenges.values()]).toEqual([
      expect.objectContaining({
        actorId: "ncolesummers",
        phase: "authorization",
        installationId: undefined,
        expiresAt: new Date("2026-08-03T04:10:00.000Z"),
      }),
    ]);
    expect(JSON.stringify([...challenges.values()])).not.toContain("reconcile-state");
  });

  it("connects an installation GitHub never announced through the setup url", async () => {
    const { connected, flow } = createReconcileHarness();
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });
    expect(connected).toEqual([{ installationId: 124_001, installedBy: "ncolesummers" }]);
  });

  it("rejects reconciliation before discovery when the immutable provider account id differs", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    Object.assign(gateway, {
      getAuthenticatedUserProviderAccountId: vi.fn(async () => "99900001"),
    });
    const listInstallations = vi.spyOn(gateway, "listUserInstallations");
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(
      flow.callback({
        actorId: "ncolesummers",
        authorizationCode: "one-time-code",
        error: null,
        installationId: null,
        pkceVerifier: "reconcile-verifier",
        setupAction: null,
        githubInstallationState: "reconcile-state",
        mode: "github",
        githubProviderAccountId: "22808397",
      }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });
    expect(listInstallations).not.toHaveBeenCalled();
    expect(connected).toEqual([]);
  });

  it("reports no-installation-found when the operator controls no installation", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "listUserInstallations").mockResolvedValue([]);
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "no-installation-found",
    });
    expect(connected).toEqual([]);
  });

  it("ignores installations belonging to a different app", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "listUserInstallations").mockResolvedValue([
      { appId: 999, installationId: 999_001 },
    ]);
    const verify = vi.spyOn(gateway, "verifyAppInstallation");
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "no-installation-found",
    });
    expect(verify).not.toHaveBeenCalled();
    expect(connected).toEqual([]);
  });

  it("refuses reconciliation when the GitHub provider account does not match the session", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "getAuthenticatedUserProviderAccountId").mockResolvedValue("99900001");
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(connected).toEqual([]);
  });

  it("refuses forged, cross-actor, and replayed reconciliation callbacks", async () => {
    const forged = createReconcileHarness();
    await expect(
      reconcileCallback(forged.flow, { githubInstallationState: "not-a-real-state" }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });
    expect(forged.connected).toEqual([]);

    const crossActor = createReconcileHarness();
    await crossActor.flow.startReconciliation({ actorId: "ncolesummers" });
    await expect(reconcileCallback(crossActor.flow, { actorId: "somebody-else" })).resolves.toEqual(
      { kind: "settings", outcome: "error" },
    );
    expect(crossActor.connected).toEqual([]);

    const replayed = createReconcileHarness();
    await replayed.flow.startReconciliation({ actorId: "ncolesummers" });
    await reconcileCallback(replayed.flow);
    await expect(reconcileCallback(replayed.flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(replayed.connected).toEqual([{ installationId: 124_001, installedBy: "ncolesummers" }]);
  });

  it("separates authorization denial from missing PKCE material", async () => {
    const denied = createReconcileHarness();
    await denied.flow.startReconciliation({ actorId: "ncolesummers" });
    await expect(
      reconcileCallback(denied.flow, { authorizationCode: null, error: "access_denied" }),
    ).resolves.toEqual({ kind: "settings", outcome: "cancelled" });

    const noVerifier = createReconcileHarness();
    await noVerifier.flow.startReconciliation({ actorId: "ncolesummers" });
    await expect(reconcileCallback(noVerifier.flow, { pkceVerifier: null })).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });

    const noCode = createReconcileHarness();
    await noCode.flow.startReconciliation({ actorId: "ncolesummers" });
    await expect(
      reconcileCallback(noCode.flow, { authorizationCode: null, error: "server_error" }),
    ).resolves.toEqual({ kind: "settings", outcome: "error" });

    expect([...denied.connected, ...noVerifier.connected, ...noCode.connected]).toEqual([]);
  });

  it("connects every verified installation the operator controls and skips the rest", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "listUserInstallations").mockResolvedValue([
      { appId: 124, installationId: 124_003 },
      { appId: 124, installationId: 124_002 },
      { appId: 124, installationId: 124_001 },
    ]);
    vi.spyOn(gateway, "verifyAppInstallation").mockImplementation(async (installationId) => {
      if (installationId === 124_002) throw new Error("github_installation_verification_failed");
      return {
        accountId: 12_400 + installationId,
        accountLogin: `loopworks-${installationId}`,
        accountType: "Organization",
        appId: 124,
        installationId,
        repositorySelection: "selected",
      };
    });
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });
    expect(connected).toEqual([
      { installationId: 124_003, installedBy: "ncolesummers" },
      { installationId: 124_001, installedBy: "ncolesummers" },
    ]);
  });

  /**
   * Reconciliation exists for the portal that has no installation at all. Once one
   * is connected, writing more rows would silently repoint repository selection,
   * which resolves an installation by lowest id with no actor filter
   * (`repository-selection.ts`). So it refuses, without calling GitHub.
   */
  it("writes nothing and calls no GitHub API once an installation is connected", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    connected.push({ installationId: 124_001, installedBy: "someone-earlier" });
    const listUserInstallations = vi.spyOn(gateway, "listUserInstallations");
    const verifyAppInstallation = vi.spyOn(gateway, "verifyAppInstallation");
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "already-connected",
    });
    expect(connected).toEqual([{ installationId: 124_001, installedBy: "someone-earlier" }]);
    expect(listUserInstallations).not.toHaveBeenCalled();
    expect(verifyAppInstallation).not.toHaveBeenCalled();
  });

  it("still consumes the challenge when it refuses an already-connected portal", async () => {
    const { connected, flow } = createReconcileHarness();
    connected.push({ installationId: 124_001, installedBy: "someone-earlier" });
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await reconcileCallback(flow);
    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
  });

  it("errors without writing when every candidate fails verification", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "verifyAppInstallation").mockRejectedValue(
      new Error("github_installation_verification_failed"),
    );
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(connected).toEqual([]);
  });

  /**
   * A rate limit or 5xx from `GET /user/installations` is the likeliest failure
   * on this path. It must resolve to the `error` outcome like every other
   * authorization-phase failure, never reject `callback()` — a rejection escapes
   * the flow's own mapping and reaches callers as an unhandled failure.
   */
  it("reports a failing installation listing as an outcome rather than rejecting", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "listUserInstallations").mockRejectedValue(
      new Error("github rate limit exceeded"),
    );
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(connected).toEqual([]);
  });

  it("reports a failing installation write as an outcome rather than rejecting", async () => {
    const { connected, flow, store } = createReconcileHarness();
    vi.spyOn(store, "connectInstallation").mockRejectedValue(new Error("database unavailable"));
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "error",
    });
    expect(connected).toEqual([]);
  });

  /**
   * The bound must keep the newest installations. GitHub ids increase
   * monotonically, so the account the operator just configured is the highest id
   * — dropping it would discard exactly the installation #151 is about.
   */
  it("bounds how many candidates one reconciliation verifies, keeping the newest", async () => {
    const { connected, flow, gateway } = createReconcileHarness();
    vi.spyOn(gateway, "listUserInstallations").mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        appId: 124,
        installationId: 124_100 - index,
      })),
    );
    vi.spyOn(gateway, "verifyAppInstallation").mockImplementation(async (installationId) => ({
      accountId: 12_400 + installationId,
      accountLogin: `loopworks-${installationId}`,
      accountType: "Organization",
      appId: 124,
      installationId,
      repositorySelection: "selected",
    }));
    await flow.startReconciliation({ actorId: "ncolesummers" });

    await expect(reconcileCallback(flow)).resolves.toEqual({
      kind: "settings",
      outcome: "connected",
    });
    expect(connected).toHaveLength(10);
    expect(connected.map((row) => row.installationId)).toEqual([
      124_100, 124_099, 124_098, 124_097, 124_096, 124_095, 124_094, 124_093, 124_092, 124_091,
    ]);
  });
});
