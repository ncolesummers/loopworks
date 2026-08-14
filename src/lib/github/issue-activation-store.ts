import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { repositories } from "@/db/schema";
import type { NormalizedGithubIssueActivation } from "@/lib/github/issue-activation-authorization";

export type GithubIssueActivationRepositoryBindingDecision =
  | {
      decision: "bound";
      installationId: number;
      owner: string;
      repo: string;
      repositoryId: number;
    }
  | {
      decision: "indeterminate";
      reason: "repository_binding_missing_or_mismatched";
    };

export type GithubIssueActivationRepositoryBindingResolver = (
  activation: NormalizedGithubIssueActivation,
) => Promise<GithubIssueActivationRepositoryBindingDecision>;

export type GithubIssueActivationRepositoryDatabase = Pick<typeof db, "select">;

export function createGithubIssueActivationRepositoryBindingResolver(
  database: GithubIssueActivationRepositoryDatabase = db,
): GithubIssueActivationRepositoryBindingResolver {
  return async (activation) => {
    const rows = await database
      .select({
        githubRepoId: repositories.githubRepoId,
        installationId: repositories.installationId,
        owner: repositories.owner,
        repo: repositories.name,
      })
      .from(repositories)
      .where(
        and(
          eq(repositories.githubRepoId, activation.repository.id),
          eq(repositories.fullName, activation.repository.fullName),
          eq(repositories.installationId, activation.installationId),
          eq(repositories.isActive, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (
      !row ||
      row.githubRepoId !== activation.repository.id ||
      row.installationId !== activation.installationId ||
      `${row.owner}/${row.repo}` !== activation.repository.fullName
    ) {
      return { decision: "indeterminate", reason: "repository_binding_missing_or_mismatched" };
    }

    return {
      decision: "bound",
      installationId: row.installationId,
      owner: row.owner,
      repo: row.repo,
      repositoryId: row.githubRepoId,
    };
  };
}
