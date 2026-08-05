import { createHash } from "node:crypto";

import {
  digestGithubInstallationState,
  type GithubInstallationFlowPhase,
} from "@/lib/github/installation-store";

const flowTtlMs = 10 * 60 * 1000;

export type GithubInstallationCallbackInput = {
  actorId: string;
  authorizationCode: string | null;
  error: string | null;
  installationId: string | null;
  pkceVerifier: string | null;
  setupAction: string | null;
  githubInstallationState: string | null;
};

export type GithubInstallationCallbackResult =
  | { kind: "authorize"; location: string; verifierCookie: string }
  | {
      kind: "settings";
      outcome: "already-connected" | "cancelled" | "connected" | "error" | "pending-approval";
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

      const state = await createChallenge({
        actorId: input.actorId,
        installationId,
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
    } catch {
      return settings("error");
    }
  }

  async function handleAuthorizationReturn(
    input: GithubInstallationCallbackInput,
  ): Promise<GithubInstallationCallbackResult> {
    const challenge = await consumeChallenge({
      actorId: input.actorId,
      phase: "authorization",
      state: input.githubInstallationState,
    });
    if (!challenge?.installationId) return settings("error");
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

    async callback(
      input: GithubInstallationCallbackInput,
    ): Promise<GithubInstallationCallbackResult> {
      if (input.authorizationCode || input.error) return handleAuthorizationReturn(input);
      return handleInstallationReturn(input);
    },
  };
}
