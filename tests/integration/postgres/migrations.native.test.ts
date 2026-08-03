/** @vitest-environment node */

import { readdirSync } from "node:fs";
import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  artifacts,
  githubInstallationFlows,
  githubInstallations,
  loopRuns,
  repositories,
} from "@/db/schema";
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
  it("applies every checked-in migration with stock Drizzle and replays idempotently", async () => {
    const client = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const db = drizzle(client, {
      schema: {
        artifacts,
        githubInstallationFlows,
        githubInstallations,
        loopRuns,
        repositories,
      },
    });
    const runId = "00000000-0000-4000-8000-000000000113";
    let repositoryId: string | undefined;

    try {
      await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
      await client`DROP SCHEMA IF EXISTS public CASCADE`;
      await client`CREATE SCHEMA public`;

      const expectedMigrations = readMigrationFiles({ migrationsFolder });
      expect(expectedMigrations.length).toBeGreaterThan(0);
      expect(expectedMigrations).toHaveLength(
        readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")).length,
      );

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

  it("upgrades a populated baseline and makes the GitHub installation tables usable", async () => {
    const client = postgres(requireSafeNativeDatabaseUrl(), {
      max: 1,
      prepare: false,
      onnotice: () => {},
    });
    const db = drizzle(client, {
      schema: { githubInstallationFlows, githubInstallations, repositories },
    });

    try {
      await client`DROP SCHEMA IF EXISTS drizzle CASCADE`;
      await client`DROP SCHEMA IF EXISTS public CASCADE`;
      await client`CREATE SCHEMA public`;

      const expectedMigrations = readMigrationFiles({ migrationsFolder });
      expect(expectedMigrations.length).toBeGreaterThan(1);
      const baseline = expectedMigrations[0];
      if (!baseline) throw new Error("Expected a baseline migration.");

      for (const statement of baseline.sql) await client.unsafe(statement);
      await client`CREATE SCHEMA drizzle`;
      await client`
        CREATE TABLE drizzle.__drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `;
      await client`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${baseline.hash}, ${baseline.folderMillis})
      `;

      await db.insert(repositories).values({
        githubRepoId: 124_000_001,
        owner: "ncolesummers",
        name: "loopworks-upgrade",
        fullName: "ncolesummers/loopworks-upgrade",
      });

      await migrate(db, { migrationsFolder });

      const preservedRepositories = await db.select().from(repositories);
      expect(preservedRepositories).toEqual([
        expect.objectContaining({ fullName: "ncolesummers/loopworks-upgrade" }),
      ]);

      await db.insert(githubInstallations).values({
        installationId: 124_001,
        appId: 124,
        accountId: 12_400,
        accountLogin: "loopworks-org",
        accountType: "Organization",
        repositorySelection: "selected",
        installedBy: "ncolesummers",
      });
      await db.insert(githubInstallationFlows).values({
        stateDigest: "native-upgrade-state-digest",
        actorId: "ncolesummers",
        phase: "installation",
        installationId: 124_001,
        expiresAt: new Date("2026-08-03T05:00:00.000Z"),
      });

      await expect(db.select().from(githubInstallations)).resolves.toEqual([
        expect.objectContaining({ installationId: 124_001 }),
      ]);
      await expect(db.select().from(githubInstallationFlows)).resolves.toEqual([
        expect.objectContaining({
          actorId: "ncolesummers",
          installationId: 124_001,
          phase: "installation",
        }),
      ]);

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
      expect(replayed[0]?.count).toBe(expectedMigrations.length);
    } finally {
      await client.end();
    }
  });
});
