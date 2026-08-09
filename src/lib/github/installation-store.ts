import { createHash } from "node:crypto";
import { and, eq, gt, isNull, lte } from "drizzle-orm";

import type { db } from "@/db/client";
import { githubInstallationFlows, githubInstallations } from "@/db/schema";

export type GithubInstallationFlowPhase = "installation" | "authorization";
export type GithubInstallationDatabase = Pick<typeof db, "insert" | "select" | "update">;
export type GithubInstallationRecord = typeof githubInstallations.$inferSelect;

export function digestGithubInstallationState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createGithubInstallationStore(database: GithubInstallationDatabase) {
  return {
    async createChallenge(input: {
      actorId: string;
      expiresAt: Date;
      installationId?: number;
      phase: GithubInstallationFlowPhase;
      stateDigest: string;
    }) {
      const [challenge] = await database
        .insert(githubInstallationFlows)
        .values({
          actorId: input.actorId,
          expiresAt: input.expiresAt,
          installationId: input.installationId,
          phase: input.phase,
          stateDigest: input.stateDigest,
        })
        .returning();
      return challenge;
    },

    async consumeChallenge(input: {
      actorId: string;
      now: Date;
      phase: GithubInstallationFlowPhase;
      stateDigest: string;
    }) {
      const [challenge] = await database
        .update(githubInstallationFlows)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(githubInstallationFlows.actorId, input.actorId),
            eq(githubInstallationFlows.phase, input.phase),
            eq(githubInstallationFlows.stateDigest, input.stateDigest),
            gt(githubInstallationFlows.expiresAt, input.now),
            isNull(githubInstallationFlows.consumedAt),
          ),
        )
        .returning();
      return challenge ?? null;
    },

    /**
     * Scoped to the configured App, matching how Settings projects installations.
     * A row left by a different App must not make this portal look connected.
     */
    async hasConnectedInstallation(input: { appId: number }): Promise<boolean> {
      const rows = await database
        .select({ installationId: githubInstallations.installationId })
        .from(githubInstallations)
        .where(eq(githubInstallations.appId, input.appId))
        .limit(1);
      return rows.length > 0;
    },

    async connectInstallation(
      input: Omit<GithubInstallationRecord, "installedAt" | "updatedAt"> & {
        installedAt: Date;
        updatedAt: Date;
      },
    ): Promise<"already-connected" | "connected"> {
      const inserted = await database
        .insert(githubInstallations)
        .values(input)
        .onConflictDoNothing({ target: githubInstallations.installationId })
        .returning({ installationId: githubInstallations.installationId });
      if (inserted.length === 1) return "connected";

      await database
        .update(githubInstallations)
        .set({
          accountId: input.accountId,
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          appId: input.appId,
          repositorySelection: input.repositorySelection,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(githubInstallations.installationId, input.installationId),
            eq(githubInstallations.appId, input.appId),
            lte(githubInstallations.updatedAt, input.updatedAt),
          ),
        );
      return "already-connected";
    },
  };
}
