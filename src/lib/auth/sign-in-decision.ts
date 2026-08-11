import {
  type AuthAllowlistConfig,
  type AuthAllowlistDecision,
  evaluateAuthAllowlist,
} from "@/lib/auth/allowlist";
import type { GithubOrganizationLookup } from "@/lib/auth/github";
import { authPages } from "@/lib/auth/pages";

export type GithubSignInEvaluation =
  | { decision: AuthAllowlistDecision; outcome: "decision" }
  | { outcome: "unavailable"; redirect: string };

/**
 * Keep provider availability separate from allowlist evidence. An empty organization list is a
 * valid denial only when GitHub answered successfully; a failed lookup must become a generic
 * configuration outcome unless direct user or bypass evidence already authorizes the operator.
 */
export function resolveGithubSignInDecision({
  config,
  githubLogin,
  githubOrganizations,
}: Readonly<{
  config: AuthAllowlistConfig;
  githubLogin: string | null;
  githubOrganizations: GithubOrganizationLookup;
}>): GithubSignInEvaluation {
  if (githubOrganizations.status === "unavailable") {
    const directDecision = evaluateAuthAllowlist(
      {
        githubLogin,
        githubOrganizations: [],
      },
      config,
    );
    if (directDecision.allowed && directDecision.reason !== "github_org") {
      return {
        decision: directDecision,
        outcome: "decision",
      };
    }

    return {
      outcome: "unavailable",
      redirect: `${authPages.signIn}?error=Configuration`,
    };
  }

  return {
    decision: evaluateAuthAllowlist(
      {
        githubLogin,
        githubOrganizations: githubOrganizations.logins,
      },
      config,
    ),
    outcome: "decision",
  };
}
