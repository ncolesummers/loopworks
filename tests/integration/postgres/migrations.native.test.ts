/** @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { applyPostgresMigrations } from "@/db/migrations";
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
  it("serializes concurrent migration callers", async () => {
    const fixtureFolder = await mkdtemp(path.join(tmpdir(), "loopworks-migrations-"));
    const metaFolder = path.join(fixtureFolder, "meta");
    await mkdir(metaFolder);
    await writeFile(
      path.join(metaFolder, "_journal.json"),
      JSON.stringify({
        entries: [{ breakpoints: true, idx: 0, tag: "0000_insert_once", when: 1 }],
      }),
    );
    await writeFile(
      path.join(fixtureFolder, "0000_insert_once.sql"),
      [
        "SELECT pg_sleep(0.1);",
        "--> statement-breakpoint",
        'INSERT INTO "issue_113_concurrency" ("value") VALUES (\'once\');',
      ].join("\n"),
    );

    const firstClient = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const secondClient = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });

    try {
      await firstClient`DROP SCHEMA IF EXISTS issue_113_concurrency_drizzle CASCADE`;
      await firstClient`DROP TABLE IF EXISTS issue_113_concurrency`;
      await firstClient`CREATE TABLE issue_113_concurrency (value text NOT NULL)`;

      const config = {
        migrationsFolder: fixtureFolder,
        migrationsSchema: "issue_113_concurrency_drizzle",
      };
      await Promise.all([
        applyPostgresMigrations(drizzle(firstClient), config),
        applyPostgresMigrations(drizzle(secondClient), config),
      ]);

      const rows = await firstClient<{ value: string }[]>`
        SELECT value
        FROM issue_113_concurrency
      `;
      expect(rows).toEqual([{ value: "once" }]);
      const applied = await firstClient<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM issue_113_concurrency_drizzle.__drizzle_migrations
      `;
      expect(applied[0]?.count).toBe(1);
    } finally {
      await firstClient`DROP SCHEMA IF EXISTS issue_113_concurrency_drizzle CASCADE`;
      await firstClient`DROP TABLE IF EXISTS issue_113_concurrency`;
      await Promise.all([firstClient.end(), secondClient.end()]);
      await rm(fixtureFolder, { force: true, recursive: true });
    }
  });

  it("commits an enum addition before a later migration first uses it", async () => {
    const fixtureFolder = await mkdtemp(path.join(tmpdir(), "loopworks-migrations-"));
    const metaFolder = path.join(fixtureFolder, "meta");
    await mkdir(metaFolder);
    await writeFile(
      path.join(metaFolder, "_journal.json"),
      JSON.stringify({
        entries: [
          { breakpoints: true, idx: 0, tag: "0000_add_screenshot", when: 1 },
          { breakpoints: true, idx: 1, tag: "0001_use_screenshot", when: 2 },
        ],
      }),
    );
    await writeFile(
      path.join(fixtureFolder, "0000_add_screenshot.sql"),
      "ALTER TYPE \"public\".\"issue_113_artifact_type\" ADD VALUE 'screenshot' BEFORE 'other';",
    );
    await writeFile(
      path.join(fixtureFolder, "0001_use_screenshot.sql"),
      'INSERT INTO "issue_113_artifacts" ("type") VALUES (\'screenshot\');',
    );

    const client = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const db = drizzle(client);

    try {
      await client`DROP SCHEMA IF EXISTS issue_113_drizzle CASCADE`;
      await client`DROP TABLE IF EXISTS issue_113_artifacts`;
      await client`DROP TYPE IF EXISTS issue_113_artifact_type`;
      await client`CREATE TYPE issue_113_artifact_type AS ENUM ('other')`;
      await client`
        CREATE TABLE issue_113_artifacts (
          type issue_113_artifact_type NOT NULL
        )
      `;

      await applyPostgresMigrations(db, {
        migrationsFolder: fixtureFolder,
        migrationsSchema: "issue_113_drizzle",
      });

      const rows = await client<{ type: string }[]>`SELECT type FROM issue_113_artifacts`;
      expect(rows).toEqual([{ type: "screenshot" }]);
    } finally {
      await client`DROP SCHEMA IF EXISTS issue_113_drizzle CASCADE`;
      await client`DROP TABLE IF EXISTS issue_113_artifacts`;
      await client`DROP TYPE IF EXISTS issue_113_artifact_type`;
      await client.end();
      await rm(fixtureFolder, { force: true, recursive: true });
    }
  });

  it("keeps prior migration files committed and rolls back a failing file", async () => {
    const fixtureFolder = await mkdtemp(path.join(tmpdir(), "loopworks-migrations-"));
    const metaFolder = path.join(fixtureFolder, "meta");
    await mkdir(metaFolder);
    await writeFile(
      path.join(metaFolder, "_journal.json"),
      JSON.stringify({
        entries: [
          { breakpoints: true, idx: 0, tag: "0000_create_table", when: 1 },
          { breakpoints: true, idx: 1, tag: "0001_committed_row", when: 2 },
          { breakpoints: true, idx: 2, tag: "0002_failing_row", when: 3 },
        ],
      }),
    );
    await writeFile(
      path.join(fixtureFolder, "0000_create_table.sql"),
      'CREATE TABLE "issue_113_rollback" ("value" text NOT NULL);',
    );
    await writeFile(
      path.join(fixtureFolder, "0001_committed_row.sql"),
      'INSERT INTO "issue_113_rollback" ("value") VALUES (\'committed\');',
    );
    await writeFile(
      path.join(fixtureFolder, "0002_failing_row.sql"),
      [
        'INSERT INTO "issue_113_rollback" ("value") VALUES (\'rolled back\');',
        "--> statement-breakpoint",
        "SELECT 1 / 0;",
      ].join("\n"),
    );

    const client = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const db = drizzle(client);

    try {
      await client`DROP SCHEMA IF EXISTS issue_113_rollback_drizzle CASCADE`;
      await client`DROP TABLE IF EXISTS issue_113_rollback`;

      await expect(
        applyPostgresMigrations(db, {
          migrationsFolder: fixtureFolder,
          migrationsSchema: "issue_113_rollback_drizzle",
        }),
      ).rejects.toThrow();

      const rows = await client<{ value: string }[]>`
        SELECT value
        FROM issue_113_rollback
        ORDER BY value
      `;
      expect(rows).toEqual([{ value: "committed" }]);
      const applied = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM issue_113_rollback_drizzle.__drizzle_migrations
      `;
      expect(applied[0]?.count).toBe(2);
    } finally {
      await client`DROP SCHEMA IF EXISTS issue_113_rollback_drizzle CASCADE`;
      await client`DROP TABLE IF EXISTS issue_113_rollback`;
      await client.end();
      await rm(fixtureFolder, { force: true, recursive: true });
    }
  });

  it("applies the complete migration journal from empty and replays idempotently", async () => {
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

      await applyPostgresMigrations(db, { migrationsFolder });

      const expectedMigrations = readMigrationFiles({ migrationsFolder });
      const applied = await client<{ hash: string }[]>`
        SELECT hash
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at
      `;
      expect(applied.map(({ hash }) => hash)).toEqual(expectedMigrations.map(({ hash }) => hash));

      await applyPostgresMigrations(db, { migrationsFolder });
      const replayed = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM drizzle.__drizzle_migrations
      `;
      expect(replayed[0]?.count).toBe(expectedMigrations.length);

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
