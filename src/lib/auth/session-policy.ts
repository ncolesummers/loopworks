import type { Session } from "next-auth";

import {
  type AuthAllowlistConfig,
  evaluateAuthAllowlist,
  readAuthAllowlistConfig,
} from "@/lib/auth/allowlist";
import { fetchGithubOrganizationLogins } from "@/lib/auth/github";
import { getAuthUserId, getGithubLoginFromAuthUser } from "@/lib/auth/identity";

export type GithubSessionAuthorization =
  | {
      authorized: true;
      reason: "bypass" | "github_user" | "github_org";
      githubLogin?: string | null;
      matchedValue: string;
    }
  | {
      authorized: false;
      reason:
        | "missing_session"
        | "missing_github_login"
        | "missing_user_id"
        | "missing_github_access_token"
        | "not_allowlisted";
      githubLogin?: string | null;
    };

export type AuthorizeGithubSessionInput = {
  session: Session | null;
  config?: AuthAllowlistConfig;
  readGithubAccessToken?: (userId: string) => Promise<string | null>;
  fetchGithubOrganizations?: typeof fetchGithubOrganizationLogins;
  now?: Date;
};

const githubOrganizationCacheTtlMs = 60_000;

type GithubOrganizationCacheEntry = {
  expiresAtMs: number;
  authorization: {
    authorized: true;
    reason: "github_org";
    githubLogin?: string | null;
    matchedValue: string;
  };
};

const githubOrganizationCache = new Map<string, GithubOrganizationCacheEntry>();

function getGithubOrganizationCacheKey(input: {
  userId: string;
  githubLogin: string;
  allowedGithubOrgs: string[];
}): string {
  return [
    input.userId,
    input.githubLogin.toLowerCase(),
    [...input.allowedGithubOrgs].sort().join(","),
  ].join(":");
}

export function clearGithubOrganizationCache(): void {
  githubOrganizationCache.clear();
}

export async function authorizeGithubSession({
  session,
  config = readAuthAllowlistConfig(),
  readGithubAccessToken,
  fetchGithubOrganizations = fetchGithubOrganizationLogins,
  now = new Date(),
}: AuthorizeGithubSessionInput): Promise<GithubSessionAuthorization> {
  if (config.bypass) {
    return {
      authorized: true,
      reason: "bypass",
      matchedValue: "LOOPWORKS_AUTH_BYPASS",
    };
  }

  if (!session?.user) {
    return {
      authorized: false,
      reason: "missing_session",
    };
  }

  const githubLogin = getGithubLoginFromAuthUser(session.user);
  if (!githubLogin) {
    return {
      authorized: false,
      reason: "missing_github_login",
    };
  }

  const userDecision = evaluateAuthAllowlist(
    {
      githubLogin,
    },
    {
      ...config,
      allowedGithubOrgs: [],
    },
  );

  if (userDecision.allowed) {
    return {
      ...userDecision,
      authorized: true,
      githubLogin,
    };
  }

  if (config.allowedGithubOrgs.length === 0) {
    return {
      authorized: false,
      reason: userDecision.reason,
      githubLogin,
    };
  }

  const userId = getAuthUserId(session.user);
  if (!userId) {
    return {
      authorized: false,
      reason: "missing_user_id",
      githubLogin,
    };
  }

  const cacheKey = getGithubOrganizationCacheKey({
    userId,
    githubLogin,
    allowedGithubOrgs: config.allowedGithubOrgs,
  });
  const nowMs = now.getTime();
  const cachedAuthorization = githubOrganizationCache.get(cacheKey);
  if (cachedAuthorization && cachedAuthorization.expiresAtMs > nowMs) {
    return cachedAuthorization.authorization;
  }

  const accessToken = readGithubAccessToken ? await readGithubAccessToken(userId) : null;
  if (!accessToken) {
    return {
      authorized: false,
      reason: "missing_github_access_token",
      githubLogin,
    };
  }

  const githubOrganizations = await fetchGithubOrganizations({
    accessToken,
  });
  const orgDecision = evaluateAuthAllowlist(
    {
      githubLogin,
      githubOrganizations,
    },
    config,
  );

  if (!orgDecision.allowed) {
    return {
      authorized: false,
      reason: orgDecision.reason,
      githubLogin,
    };
  }

  const authorization: GithubOrganizationCacheEntry["authorization"] = {
    authorized: true,
    reason: "github_org",
    matchedValue: orgDecision.matchedValue,
    githubLogin,
  };
  githubOrganizationCache.set(cacheKey, {
    expiresAtMs: nowMs + githubOrganizationCacheTtlMs,
    authorization,
  });

  return authorization;
}
