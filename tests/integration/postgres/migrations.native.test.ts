/** @vitest-environment node */

import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { artifacts, loopRuns, repositories } from "@/db/schema";
import { getLocalDatabaseSafetyError } from "../../../scripts/local-database-safety";

const migrationsFolder = path.resolve("drizzle");

function requireSafeNativeDatabaseUrl(): string {
  const safetyError = getLocalDatabaseSafetyError(process.env, {
    requiredDatabaseName: "loopworks_e2e",
    requireExplicitUrl: true,
  });
  if (safetyError) throw new Error(safetyError);
  return process.env.DATABASE_URL as string;
}

describe("programmatic migrations on native PostgreSQL", () => {
  it("applies the fresh baseline with stock Drizzle and replays idempotently", async () => {
    const client = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const db = drizzle(client, { schema: { artifacts, loopRuns, repositories } });
    const runId = "00000000-0000-4000-8000-000000000113";
    let repositoryId: string | undefined;

    try {
      await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
      await client`DROP SCHEMA IF EXISTS public CASCADE`;
      await client`CREATE SCHEMA public`;

      const expectedMigrations = readMigrationFiles({ migrationsFolder });
      expect(expectedMigrations).toHaveLength(1);

      await migrate(db, { migrationsFolder });

      const applied = await client<{ hash: string }[]>`
        SELECT hash
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at
      `;
      expect(applied.map(({ hash }) => hash)).toEqual(expectedMigrations.map(({ hash }) => hash));

      await migrate(db, { migrationsFolder });
      const replayed = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM drizzle.__drizzle_migrations
      `;
      expect(replayed[0]?.count).toBe(1);

      const [repository] = await db
        .insert(repositories)
        .values({
          githubRepoId: 113_000_001,
          owner: "ncolesummers",
          name: "loopworks",
          fullName: "ncolesummers/loopworks",
        })
        .returning({ id: repositories.id });
      if (!repository) throw new Error("Expected repository fixture.");
      repositoryId = repository.id;

      await db.insert(loopRuns).values({
        id: runId,
        loopKey: "development-loop",
        repositoryId: repository.id,
      });
      const [artifact] = await db
        .insert(artifacts)
        .values({
          runId,
          title: "Migration replay evidence",
          type: "screenshot",
          uri: "artifact://issue-113/screenshot",
        })
        .returning({ type: artifacts.type });
      expect(artifact?.type).toBe("screenshot");
    } finally {
      if (repositoryId) {
        await client`DELETE FROM artifacts WHERE run_id = ${runId}`;
        await client`DELETE FROM loop_runs WHERE id = ${runId}`;
        await client`DELETE FROM repositories WHERE id = ${repositoryId}`;
      }
      await client.end();
    }
  });
});
