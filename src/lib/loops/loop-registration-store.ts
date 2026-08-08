import { asc, eq } from "drizzle-orm";

import type { db } from "@/db/client";
import { loopDefinitions, repositories } from "@/db/schema";

import type { LoopDefinition } from "../../../schemas/loop-manifest";

export type LoopDefinitionDatabase = Pick<typeof db, "insert" | "select">;

export type TrackedRepository = {
  defaultBranch: string;
  fullName: string;
  id: string;
  name: string;
  owner: string;
};

export type RegisteredLoopDefinition = {
  definition: LoopDefinition;
  enabled: boolean;
  loopKey: string;
  repositoryFullName: string;
};

export type LoopRegistrationOutcome = "duplicate-key" | "registered" | "repository-missing";

export type LoopRegistrationRecord = {
  definition: LoopDefinition;
  now: Date;
  repositoryId: string;
};

function isForeignKeyViolation(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown }; code?: unknown } | null)?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === "23503" || causeCode === "23503";
}

export function createLoopDefinitionStore(database: LoopDefinitionDatabase) {
  return {
    /** The repositories an operator may scope a loop to: everything already in the catalog. */
    async listTrackedRepositories(): Promise<TrackedRepository[]> {
      return database
        .select({
          defaultBranch: repositories.defaultBranch,
          fullName: repositories.fullName,
          id: repositories.id,
          name: repositories.name,
          owner: repositories.owner,
        })
        .from(repositories)
        .orderBy(asc(repositories.fullName));
    },

    async listRegistered(): Promise<RegisteredLoopDefinition[]> {
      return database
        .select({
          definition: loopDefinitions.definition,
          enabled: loopDefinitions.enabled,
          loopKey: loopDefinitions.loopKey,
          repositoryFullName: repositories.fullName,
        })
        .from(loopDefinitions)
        .innerJoin(repositories, eq(loopDefinitions.repositoryId, repositories.id))
        .orderBy(asc(repositories.fullName), asc(loopDefinitions.loopKey));
    },

    async register(input: LoopRegistrationRecord): Promise<LoopRegistrationOutcome> {
      try {
        const inserted = await database
          .insert(loopDefinitions)
          .values({
            createdAt: input.now,
            definition: input.definition,
            // The stored flag mirrors the definition so the registry never has to parse jsonb to
            // answer "is this loop enabled"; the definition stays the authority on everything else.
            enabled: input.definition.enabled,
            loopKey: input.definition.key,
            repositoryId: input.repositoryId,
            updatedAt: input.now,
          })
          // Registration never overwrites: a second loop with the same key on the same repository
          // is an operator mistake, and silently replacing the first would destroy a live contract.
          .onConflictDoNothing({
            target: [loopDefinitions.repositoryId, loopDefinitions.loopKey],
          })
          .returning({ id: loopDefinitions.id });

        return inserted.length === 1 ? "registered" : "duplicate-key";
      } catch (error) {
        // A repository deselected between reading the form and submitting it is an ordinary race,
        // not a server fault.
        if (isForeignKeyViolation(error)) return "repository-missing";
        throw error;
      }
    },
  };
}
