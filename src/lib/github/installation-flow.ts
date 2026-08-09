import { createHash } from "node:crypto";

import {
  digestGithubInstallationState,
  type GithubInstallationFlowPhase,
} from "@/lib/github/installation-store";

const flowTtlMs = 10 * 60 * 1000;
/**
 * Reconciliation verifies each candidate as the App, so an operator who belongs
 * to many accounts must not turn one callback into unbounded App API calls.
 */
const maxReconciliationCandidates = 10;

export type GithubInstallationCallbackInput = {
  actorId: string;
  authorizationCode: string | null;
  error: string | null;
  installationId: string | null;
  pkceVerifier: string | null;
  setupAction: string | null;
  githubInstallationState: string | null;
};

export type GithubInstallationAuthorizeRedirect = {
  kind: "authorize";
  location: string;
  verifierCookie: string;
};

export type GithubInstallationCallbackResult =
  | GithubInstallationAuthorizeRedirect
  | {
      kind: "settings";
      outcome:
        | "already-connected"
        | "cancelled"
        | "connected"
        | "error"
        | "no-installation-found"
        | "pending-approval";
    };

export type GithubInstallationChallenge = {
  actorId: string;
  consumedAt: Date | null;
  expiresAt: Date;
  installationId?: number | null;
  phase: GithubInstallationFlowPhase;
  stateDigest: string;
};

export type VerifiedGithubInstallation = {
  accountId: number;
  accountLogin: string;
  accountType: string;
  appId: number;
  installationId: number;
  repositorySelection: string;
  suspendedAt?: string | null;
};

export type GithubInstallationStore = {
  connectInstallation(input: {
    accountId: number;
    accountLogin: string;
    accountType: string;
    appId: number;
    installationId: number;
    installedAt: Date;
    installedBy: string;
    repositorySelection: string;
    updatedAt: Date;
  }): Promise<"already-connected" | "connected">;
  consumeChallenge(input: {
    actorId: string;
    now: Date;
    phase: GithubInstallationFlowPhase;
    stateDigest: string;
  }): Promise<GithubInstallationChallenge | null>;
  createChallenge(input: {
    actorId: string;
    expiresAt: Date;
    installationId?: number;
    phase: GithubInstallationFlowPhase;
    stateDigest: string;
  }): Promise<GithubInstallationChallenge | undefined>;
  hasConnectedInstallation(input: { appId: number }): Promise<boolean>;
};

export type AvailableGithubRepository = {
  archived: boolean;
  defaultBranch: string;
  fullName: string;
  githubRepoId: number;
  name: string;
  owner: string;
  private: boolean;
};

export type AccessibleGithubInstallation = {
  appId: number;
  installationId: number;
};

export type GithubInstallationGateway = {
  exchangeUserCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string>;
  getAuthenticatedUserLogin(accessToken: string): Promise<string>;
  listInstallationRepositories(installationId: number): Promise<AvailableGithubRepository[]>;
  listUserInstallations(accessToken: string): Promise<AccessibleGithubInstallation[]>;
  userCanAccessInstallation(accessToken: string, installationId: number): Promise<boolean>;
  verifyAppInstallation(installationId: number): Promise<VerifiedGithubInstallation>;
};

export type GithubInstallationConfig = {
  appId: number;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  slug: string;
};

function settings(
  outcome: Extract<GithubInstallationCallbackResult, { kind: "settings" }>["outcome"],
): GithubInstallationCallbackResult {
  return { kind: "settings", outcome };
}

function parseInstallationId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "utf8").digest("base64url");
}

export function createGithubInstallationFlow(dependencies: {
  config: GithubInstallationConfig;
  gateway: GithubInstallationGateway;
  generateSecret: () => string;
  now: () => Date;
  store: GithubInstallationStore;
}) {
  async function createChallenge(input: {
    actorId: string;
    installationId?: number;
    phase: GithubInstallationFlowPhase;
  }) {
    const state = dependencies.generateSecret();
    const now = dependencies.now();
    await dependencies.store.createChallenge({
      actorId: input.actorId,
      expiresAt: new Date(now.getTime() + flowTtlMs),
      installationId: input.installationId,
      phase: input.phase,
      stateDigest: digestGithubInstallationState(state),
    });
    return state;
  }

  async function consumeChallenge(input: {
    actorId: string;
    phase: GithubInstallationFlowPhase;
    state: string | null;
  }) {
    if (!input.state) return null;
    return dependencies.store.consumeChallenge({
      actorId: input.actorId,
      now: dependencies.now(),
      phase: input.phase,
      stateDigest: digestGithubInstallationState(input.state),
    });
  }

  /**
   * Both entries into the authorization phase mint fresh state and a fresh PKCE
   * verifier against the one registered callback URL. Keeping them in one place
   * stops the Setup-URL entry and the operator-initiated entry from drifting
   * apart in what they bind.
   */
  async function beginAuthorization(input: {
    actorId: string;
    installationId?: number;
  }): Promise<GithubInstallationAuthorizeRedirect> {
    const state = await createChallenge({
      actorId: input.actorId,
      installationId: input.installationId,
      phase: "authorization",
    });
    const verifier = dependencies.generateSecret();
    const location = new URL("https://github.com/login/oauth/authorize");
    location.searchParams.set("client_id", dependencies.config.clientId);
    location.searchParams.set("redirect_uri", dependencies.config.callbackUrl);
    location.searchParams.set("state", state);
    location.searchParams.set("code_challenge", pkceChallenge(verifier));
    location.searchParams.set("code_challenge_method", "S256");

    return {
      kind: "authorize",
      location: location.toString(),
      verifierCookie: verifier,
    };
  }

  async function handleInstallationReturn(
    input: GithubInstallationCallbackInput,
  ): Promise<GithubInstallationCallbackResult> {
    const challenge = await consumeChallenge({
      actorId: input.actorId,
      phase: "installation",
      state: input.githubInstallationState,
    });
    if (!challenge) return settings("error");
    if (input.setupAction === "request") return settings("pending-approval");

    const installationId = parseInstallationId(input.installationId);
    if (!installationId) return settings("cancelled");

    try {
      const installation = await dependencies.gateway.verifyAppInstallation(installationId);
      if (
        installation.installationId !== installationId ||
        installation.appId !== dependencies.config.appId ||
        installation.suspendedAt
      ) {
        return settings("error");
      }

      return beginAuthorization({ actorId: input.actorId, installationId });
    } catch {
      return settings("error");
    }
  }

  /**
   * Connects every installation of the configured App that the authorized
   * operator can reach. Each candidate is still verified as the App before any
   * write, so the operator token selects candidates but never authenticates
   * them.
   */
  async function reconcileFromOperatorToken(input: {
    accessToken: string;
    actorId: string;
  }): Promise<GithubInstallationCallbackResult> {
    // Reconciliation is the recovery path for a portal with no installation at
    // all (#151). Once one is connected, adding more rows would silently repoint
    // repository selection, which resolves an installation by lowest id with no
    // actor scoping (`repository-selection.ts`). Refuse before spending any
    // GitHub call. Connecting a second account needs an explicit selection
    // surface, not a side effect of this route.
    if (await dependencies.store.hasConnectedInstallation({ appId: dependencies.config.appId })) {
      return settings("already-connected");
    }

    const accessible = await dependencies.gateway.listUserInstallations(input.accessToken);
    const candidates = [
      ...new Set(
        accessible
          .filter((installation) => installation.appId === dependencies.config.appId)
          .map((installation) => installation.installationId),
      ),
    ]
      // Newest first. GitHub installation ids increase monotonically, so the
      // installation the operator just configured — the one #151 is about — is
      // the highest id, and must survive the bound rather than be the first
      // thing it discards.
      .sort((left, right) => right - left)
      .slice(0, maxReconciliationCandidates);
    if (candidates.length === 0) return settings("no-installation-found");

    let connectedAny = false;
    let verifiedAny = false;
    for (const installationId of candidates) {
      let installation: VerifiedGithubInstallation;
      try {
        installation = await dependencies.gateway.verifyAppInstallation(installationId);
      } catch {
        // One unverifiable or suspended installation must not deny the operator
        // the others they legitimately control.
        continue;
      }
      if (
        installation.installationId !== installationId ||
        installation.appId !== dependencies.config.appId ||
        installation.suspendedAt
      ) {
        continue;
      }
      verifiedAny = true;
      const now = dependencies.now();
      const outcome = await dependencies.store.connectInstallation({
        accountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        appId: installation.appId,
        installationId: installation.installationId,
        installedAt: now,
        installedBy: input.actorId,
        repositorySelection: installation.repositorySelection,
        updatedAt: now,
      });
      connectedAny ||= outcome === "connected";
    }

    if (!verifiedAny) return settings("error");
    return settings(connectedAny ? "connected" : "already-connected");
  }

  async function handleAuthorizationReturn(
    input: GithubInstallationCallbackInput,
  ): Promise<GithubInstallationCallbackResult> {
    const challenge = await consumeChallenge({
      actorId: input.actorId,
      phase: "authorization",
      state: input.githubInstallationState,
    });
    if (!challenge) return settings("error");
    if (input.error === "access_denied") return settings("cancelled");
    if (input.error || !input.authorizationCode || !input.pkceVerifier) {
      return settings("error");
    }

    try {
      const accessToken = await dependencies.gateway.exchangeUserCode({
        clientId: dependencies.config.clientId,
        clientSecret: dependencies.config.clientSecret,
        code: input.authorizationCode,
        codeVerifier: input.pkceVerifier,
        redirectUri: dependencies.config.callbackUrl,
      });
      const githubLogin = await dependencies.gateway.getAuthenticatedUserLogin(accessToken);
      if (githubLogin.toLowerCase() !== input.actorId.toLowerCase()) return settings("error");
      // An authorization challenge carrying no candidate installation is an
      // operator-initiated reconciliation: GitHub never called the Setup URL, so
      // there is no candidate to bind and the operator's own token is what
      // establishes which installations they may reconcile (#151).
      if (!challenge.installationId) {
        // Awaited inside this `try` on purpose: returning the promise would let a
        // gateway or store rejection escape the catch below and reject
        // `callback()` itself, which every caller treats as an unhandled failure
        // rather than the `error` outcome.
        return await reconcileFromOperatorToken({ accessToken, actorId: input.actorId });
      }
      if (
        !(await dependencies.gateway.userCanAccessInstallation(
          accessToken,
          challenge.installationId,
        ))
      ) {
        return settings("error");
      }

      const installation = await dependencies.gateway.verifyAppInstallation(
        challenge.installationId,
      );
      if (
        installation.installationId !== challenge.installationId ||
        installation.appId !== dependencies.config.appId ||
        installation.suspendedAt
      ) {
        return settings("error");
      }
      const now = dependencies.now();
      const outcome = await dependencies.store.connectInstallation({
        accountId: installation.accountId,
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        appId: installation.appId,
        installationId: installation.installationId,
        installedAt: now,
        installedBy: input.actorId,
        repositorySelection: installation.repositorySelection,
        updatedAt: now,
      });
      return settings(outcome);
    } catch {
      return settings("error");
    }
  }

  return {
    async start(input: { actorId: string }) {
      const state = await createChallenge({
        actorId: input.actorId,
        phase: "installation",
      });
      const location = new URL(
        `https://github.com/apps/${encodeURIComponent(dependencies.config.slug)}/installations/new`,
      );
      location.searchParams.set("state", state);
      return { location: location.toString() };
    },

    /**
     * GitHub only installs from `/installations/new` when an eligible target
     * lacks the App; otherwise it short-circuits to the configure page and never
     * calls the Setup URL (#151). This is the operator's own way into the
     * authorization phase for an installation that already exists.
     */
    async startReconciliation(input: { actorId: string }) {
      return beginAuthorization({ actorId: input.actorId });
    },

    async callback(
      input: GithubInstallationCallbackInput,
    ): Promise<GithubInstallationCallbackResult> {
      if (input.authorizationCode || input.error) return handleAuthorizationReturn(input);
      return handleInstallationReturn(input);
    },
  };
}
