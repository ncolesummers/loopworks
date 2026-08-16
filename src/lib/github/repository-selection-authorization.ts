import type { RepositorySelectionAuthorizationSubject } from "@/lib/auth/repository-selection-subject";
import type { ConnectedGithubInstallation } from "@/lib/github/repository-selection";

export type RepositorySelectionAuthorizationOutcome =
  | "access-denied"
  | "authorized"
  | "indeterminate";

export type RepositorySelectionAuthorizationDecision = {
  cacheHit: boolean;
  outcome: RepositorySelectionAuthorizationOutcome;
};

export function repositorySelectionAuthorizationMonotonicNow(): number {
  return performance.now();
}

type AuthorizationTuple = {
  appId: number;
  githubProviderAccountId: string;
  installationId: number;
};

function tupleKey(tuple: AuthorizationTuple): string {
  return JSON.stringify([tuple.githubProviderAccountId, tuple.appId, tuple.installationId]);
}

export function createRepositorySelectionAuthorizationCache(input: {
  now: () => number;
  ttlMs: number;
}) {
  const positiveExpiries = new Map<string, number>();
  const inFlight = new Map<string, Promise<RepositorySelectionAuthorizationDecision>>();

  return {
    async authorize(
      tuple: AuthorizationTuple,
      check: () => Promise<boolean>,
    ): Promise<RepositorySelectionAuthorizationDecision> {
      const currentTime = input.now();
      for (const [cachedKey, cachedExpiry] of positiveExpiries) {
        if (currentTime >= cachedExpiry) positiveExpiries.delete(cachedKey);
      }
      const key = tupleKey(tuple);
      const expiresAt = positiveExpiries.get(key);
      if (expiresAt !== undefined) {
        if (currentTime < expiresAt) return { cacheHit: true, outcome: "authorized" };
        positiveExpiries.delete(key);
      }

      const pending = inFlight.get(key);
      if (pending) return pending;

      const attempt = (async (): Promise<RepositorySelectionAuthorizationDecision> => {
        try {
          const authorized = await check();
          if (!authorized) return { cacheHit: false, outcome: "access-denied" };
          positiveExpiries.set(key, input.now() + input.ttlMs);
          return { cacheHit: false, outcome: "authorized" };
        } catch {
          return { cacheHit: false, outcome: "indeterminate" };
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, attempt);
      return attempt;
    },
  };
}

type RepositorySelectionAuthorizationCache = ReturnType<
  typeof createRepositorySelectionAuthorizationCache
>;

function canonicalProviderAccountId(value: string): boolean {
  if (!/^[1-9]\d*$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed.toString() === value;
}

export function createRepositorySelectionAuthorizer(dependencies: {
  appId: number;
  authGithubClientId: string | null | undefined;
  cache: RepositorySelectionAuthorizationCache;
  githubAppClientId: string | null | undefined;
  readAccessEvidence(
    subject: RepositorySelectionAuthorizationSubject,
  ): Promise<{ accessToken: string } | null>;
  userCanAccessInstallation(accessToken: string, installationId: number): Promise<boolean>;
}) {
  return {
    async authorize(
      subject: RepositorySelectionAuthorizationSubject,
      installation: Pick<ConnectedGithubInstallation, "appId" | "installationId">,
    ): Promise<RepositorySelectionAuthorizationDecision> {
      const authUserId = subject.authUserId.trim();
      const authGithubClientId = dependencies.authGithubClientId?.trim();
      const githubAppClientId = dependencies.githubAppClientId?.trim();
      if (
        !authUserId ||
        !canonicalProviderAccountId(subject.githubProviderAccountId) ||
        !Number.isSafeInteger(dependencies.appId) ||
        dependencies.appId <= 0 ||
        installation.appId !== dependencies.appId ||
        !Number.isSafeInteger(installation.installationId) ||
        installation.installationId <= 0 ||
        !authGithubClientId ||
        !githubAppClientId ||
        authGithubClientId !== githubAppClientId
      ) {
        return { cacheHit: false, outcome: "indeterminate" };
      }

      let evidence: { accessToken: string } | null;
      try {
        evidence = await dependencies.readAccessEvidence(subject);
      } catch {
        return { cacheHit: false, outcome: "indeterminate" };
      }
      const accessToken = evidence?.accessToken;
      if (!accessToken || accessToken.trim() !== accessToken) {
        return { cacheHit: false, outcome: "indeterminate" };
      }

      return dependencies.cache.authorize(
        {
          appId: dependencies.appId,
          githubProviderAccountId: subject.githubProviderAccountId,
          installationId: installation.installationId,
        },
        () => dependencies.userCanAccessInstallation(accessToken, installation.installationId),
      );
    },
  };
}
