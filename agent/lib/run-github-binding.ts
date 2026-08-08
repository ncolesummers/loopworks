import { eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { loopRuns, repositories } from "@/db/schema";

export type RunGithubBinding = {
  installationId: number;
  issueNumber: number;
  owner: string;
  repo: string;
  repositoryFullName: string;
  runId: string;
};

type QueryResult = {
  fullName: string;
  installationId: number | null;
  issueNumber: number | null;
  name: string;
  owner: string;
};

type QueryBuilder = {
  from(table: unknown): QueryBuilder;
  innerJoin(table: unknown, condition: unknown): QueryBuilder;
  limit(count: number): Promise<QueryResult[]>;
  where(condition: unknown): QueryBuilder;
};

export type RunGithubBindingDatabase = {
  select(fields: Record<string, PgColumn>): QueryBuilder;
};

const repositorySegmentPattern = /^[A-Za-z0-9_.-]+$/;

export async function resolveRunGithubBinding(
  runId: string,
  database: RunGithubBindingDatabase = db as unknown as RunGithubBindingDatabase,
): Promise<RunGithubBinding> {
  let row: QueryResult | undefined;
  try {
    [row] = await database
      .select({
        fullName: repositories.fullName,
        installationId: repositories.installationId,
        issueNumber: loopRuns.githubIssueNumber,
        name: repositories.name,
        owner: repositories.owner,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, runId))
      .limit(1);
  } catch {
    throw new Error("run_github_binding_failed");
  }
  if (!row) throw new Error("run_github_binding_missing");
  if (!row.installationId || !Number.isSafeInteger(row.installationId) || row.installationId <= 0) {
    throw new Error("run_github_installation_unbound");
  }
  if (!row.issueNumber || !Number.isSafeInteger(row.issueNumber) || row.issueNumber <= 0) {
    throw new Error("run_github_issue_unbound");
  }
  if (
    !repositorySegmentPattern.test(row.owner) ||
    !repositorySegmentPattern.test(row.name) ||
    row.fullName !== `${row.owner}/${row.name}`
  ) {
    throw new Error("run_github_repository_invalid");
  }
  return {
    installationId: row.installationId,
    issueNumber: row.issueNumber,
    owner: row.owner,
    repo: row.name,
    repositoryFullName: row.fullName,
    runId,
  };
}
