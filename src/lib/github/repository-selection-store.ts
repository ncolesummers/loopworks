import { and, asc, eq, isNull, notExists, or, sql } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  githubInstallations,
  loopDefinitions,
  loopRuns,
  loops,
  repositories,
  vercelProjects,
} from "@/db/schema";
import type { ConnectedGithubInstallation } from "@/lib/github/repository-selection";

export type GithubRepositorySelectionDatabase = Pick<
  typeof db,
  "delete" | "insert" | "select" | "update"
>;
export type SelectedRepositoryRecord = typeof repositories.$inferSelect;

export type RepositorySelectionOutcome =
  | "already-selected"
  | "name-conflict"
  | "owned-by-other-installation"
  | "selected";
export type RepositoryDeselectionOutcome = "deselected" | "in-use" | "not-selected";

export type RepositorySelectionInput = {
  defaultBranch: string;
  fullName: string;
  githubRepoId: number;
  installationId: number;
  name: string;
  now: Date;
  owner: string;
};

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown }; code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "23505" || causeCode === "23505";
}

export function createGithubRepositorySelectionStore(
  database: GithubRepositorySelectionDatabase,
  options: { appId?: number } = {},
) {
  /** Rows the acting installation may write: its own, plus rows no installation has claimed. */
  function writableBy(installationId: number) {
    return or(eq(repositories.installationId, installationId), isNull(repositories.installationId));
  }

  return {
    /**
     * Only installations belonging to the configured App are onboarding sources of truth; a row
     * left behind by a different App must never grant repository access here.
     */
    async listInstallations(): Promise<ConnectedGithubInstallation[]> {
      const rows = await database
        .select({
          accountLogin: githubInstallations.accountLogin,
          accountType: githubInstallations.accountType,
          appId: githubInstallations.appId,
          installationId: githubInstallations.installationId,
          repositorySelection: githubInstallations.repositorySelection,
        })
        .from(githubInstallations)
        .orderBy(asc(githubInstallations.installationId));
      return options.appId === undefined
        ? rows
        : rows.filter((installation) => installation.appId === options.appId);
    },

    async listSelected(installationId: number): Promise<SelectedRepositoryRecord[]> {
      return database
        .select()
        .from(repositories)
        .where(eq(repositories.installationId, installationId));
    },

    async select(input: RepositorySelectionInput): Promise<RepositorySelectionOutcome> {
      const identity = {
        defaultBranch: input.defaultBranch,
        fullName: input.fullName,
        installationId: input.installationId,
        isActive: true,
        lastSyncedAt: input.now,
        name: input.name,
        owner: input.owner,
      };

      try {
        const inserted = await database
          .insert(repositories)
          .values({ githubRepoId: input.githubRepoId, ...identity })
          .onConflictDoNothing({ target: repositories.githubRepoId })
          .returning({ id: repositories.id });
        if (inserted.length === 1) return "selected";

        // Refresh identity only for a row this installation is allowed to write. A row owned by a
        // different installation is never silently re-parented.
        const updated = await database
          .update(repositories)
          .set(identity)
          .where(
            and(
              eq(repositories.githubRepoId, input.githubRepoId),
              writableBy(input.installationId),
            ),
          )
          .returning({ id: repositories.id });
        return updated.length === 1 ? "already-selected" : "owned-by-other-installation";
      } catch (error) {
        // `full_name` is unique independently of `github_repo_id`: a deleted-and-recreated or
        // renamed repository can collide with a stale row. Report it instead of failing the save.
        if (isUniqueViolation(error)) return "name-conflict";
        throw error;
      }
    },

    async deselect(input: {
      githubRepoId: number;
      installationId: number;
    }): Promise<RepositoryDeselectionOutcome> {
      // Deleting `repositories` cascades to loops, registered loop definitions, runs, and Vercel
      // project links, so the guard and the delete must be one statement: a separate count would be
      // a time-of-check race.
      const deleted = await database
        .delete(repositories)
        .where(
          and(
            eq(repositories.githubRepoId, input.githubRepoId),
            eq(repositories.installationId, input.installationId),
            notExists(
              database
                .select({ present: sql`1` })
                .from(loops)
                .where(eq(loops.repositoryId, repositories.id)),
            ),
            notExists(
              database
                .select({ present: sql`1` })
                .from(loopDefinitions)
                .where(eq(loopDefinitions.repositoryId, repositories.id)),
            ),
            notExists(
              database
                .select({ present: sql`1` })
                .from(loopRuns)
                .where(eq(loopRuns.repositoryId, repositories.id)),
            ),
            notExists(
              database
                .select({ present: sql`1` })
                .from(vercelProjects)
                .where(eq(vercelProjects.repositoryId, repositories.id)),
            ),
          ),
        )
        .returning({ id: repositories.id });
      if (deleted.length === 1) return "deselected";

      const [remaining] = await database
        .select({ id: repositories.id })
        .from(repositories)
        .where(
          and(
            eq(repositories.githubRepoId, input.githubRepoId),
            eq(repositories.installationId, input.installationId),
          ),
        );
      return remaining ? "in-use" : "not-selected";
    },
  };
}
