#!/usr/bin/env bun

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  type MigrationEnvironment,
  resolveMigrationDatabaseUrl,
} from "../src/db/neon-migration-config";

type MigrationClient = ReturnType<typeof postgres>;

export type MigrationRunnerDependencies = {
  createClient: (databaseUrl: string) => MigrationClient;
  migrateDatabase: (client: MigrationClient) => Promise<void>;
};

export const MIGRATION_ADVISORY_LOCK_ID = 70_018;

const defaultDependencies: MigrationRunnerDependencies = {
  createClient: (databaseUrl) =>
    postgres(databaseUrl, {
      max: 1,
      prepare: false,
    }),
  migrateDatabase: async (client) => {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  },
};

export async function runMigrations(
  environment: MigrationEnvironment = process.env,
  dependencies: MigrationRunnerDependencies = defaultDependencies,
): Promise<void> {
  const databaseUrl = resolveMigrationDatabaseUrl(environment);
  const client = dependencies.createClient(databaseUrl);
  let lockAcquired = false;

  try {
    await client.unsafe("select pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;
    await dependencies.migrateDatabase(client);
  } finally {
    try {
      if (lockAcquired) {
        await client.unsafe("select pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_ID]);
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  }
}

if (import.meta.main) {
  try {
    await runMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database migration failed.");
    process.exitCode = 1;
  }
}
