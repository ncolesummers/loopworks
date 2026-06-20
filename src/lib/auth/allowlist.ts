import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type AuthAllowlistConfig = {
  bypass: boolean;
  allowedGithubUsers: string[];
  allowedGithubOrgs: string[];
};

export type AuthAllowlistSubject = {
  githubLogin?: string | null;
  githubOrganizations?: string[] | null;
};

export type AuthAllowlistDecision =
  | { allowed: true; reason: "bypass" | "github_user" | "github_org"; matchedValue: string }
  | { allowed: false; reason: "missing_github_login" | "not_allowlisted" };

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function parseCsvAllowlist(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map(normalizeValue)
    .filter((entry) => entry.length > 0);
}

export function readAuthAllowlistConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): AuthAllowlistConfig {
  const bypassRequested = isTruthyEnvValue(env.LOOPWORKS_AUTH_BYPASS);

  return {
    bypass: bypassRequested && !isProductionRuntime(env),
    allowedGithubUsers: parseCsvAllowlist(env.LOOPWORKS_ALLOWED_GITHUB_USERS),
    allowedGithubOrgs: parseCsvAllowlist(env.LOOPWORKS_ALLOWED_GITHUB_ORGS),
  };
}

export function evaluateAuthAllowlist(
  subject: AuthAllowlistSubject,
  config: AuthAllowlistConfig,
): AuthAllowlistDecision {
  if (config.bypass) {
    return {
      allowed: true,
      reason: "bypass",
      matchedValue: "LOOPWORKS_AUTH_BYPASS",
    };
  }

  const githubLogin = subject.githubLogin ? normalizeValue(subject.githubLogin) : "";
  if (!githubLogin) {
    return {
      allowed: false,
      reason: "missing_github_login",
    };
  }

  if (config.allowedGithubUsers.includes(githubLogin)) {
    return {
      allowed: true,
      reason: "github_user",
      matchedValue: githubLogin,
    };
  }

  const githubOrganizations = (subject.githubOrganizations ?? []).map(normalizeValue);
  const matchedOrganization = githubOrganizations.find((organization) =>
    config.allowedGithubOrgs.includes(organization),
  );

  if (matchedOrganization) {
    return {
      allowed: true,
      reason: "github_org",
      matchedValue: matchedOrganization,
    };
  }

  return {
    allowed: false,
    reason: "not_allowlisted",
  };
}

export function isAllowedGithubIdentity(
  subject: AuthAllowlistSubject,
  config: AuthAllowlistConfig = readAuthAllowlistConfig(),
): boolean {
  return evaluateAuthAllowlist(subject, config).allowed;
}
