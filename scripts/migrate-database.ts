#!/usr/bin/env bun

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import {
  type MigrationEnvironment,
  resolveMigrationDatabaseUrl,
} from "../src/db/neon-migration-config";
import { assertPreviewStoreIdentityIsNotProduction } from "../src/db/store-identity-fingerprint";
import {
  assertPreviewMigrationLease,
  type PreviewMigrationLeaseResult,
} from "./assert-preview-migration-lease";

type MigrationClient = ReturnType<typeof postgres>;

export type MigrationRunnerDependencies = {
  assertPreviewMigrationLease?: (
    environment: MigrationEnvironment,
  ) => Promise<PreviewMigrationLeaseResult>;
  createClient: (databaseUrl: string) => MigrationClient;
  migrateDatabase: (client: MigrationClient) => Promise<void>;
  readPreviewStoreIdentity?: (client: MigrationClient) => Promise<PreviewStoreIdentity>;
};

export type PreviewStoreIdentity =
  | { status: "present"; storeId: string }
  | { status: "missing_row" }
  | { status: "missing_table" };

export const MIGRATION_ADVISORY_LOCK_ID = 70_018;

async function readPreviewStoreIdentity(client: MigrationClient): Promise<PreviewStoreIdentity> {
  try {
    const rows = (await client.unsafe(
      'select "store_id" from "store_identity" where "id" = 1',
    )) as unknown as { store_id?: unknown }[];
    const storeId = rows[0]?.store_id;
    return typeof storeId === "string" ? { status: "present", storeId } : { status: "missing_row" };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "42P01"
    ) {
      return { status: "missing_table" };
    }
    throw error;
  }
}

const defaultDependencies: MigrationRunnerDependencies = {
  createClient: (databaseUrl) =>
    postgres(databaseUrl, {
      max: 1,
      prepare: false,
    }),
  migrateDatabase: async (client) => {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  },
  readPreviewStoreIdentity,
  assertPreviewMigrationLease,
};

function isPreview(environment: MigrationEnvironment): boolean {
  return environment.VERCEL_ENV?.trim().toLowerCase() === "preview";
}

function validStoreIdentity(value: string | undefined): value is string {
  return Boolean(value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i));
}

function assertPreviewExpectedStoreIdentity(environment: MigrationEnvironment): void {
  if (!isPreview(environment)) return;
  const expected = environment.LOOPWORKS_EXPECTED_STORE_ID?.trim();
  if (!validStoreIdentity(expected)) {
    throw new Error("Preview database migrations require a valid LOOPWORKS_EXPECTED_STORE_ID.");
  }
  assertPreviewStoreIdentityIsNotProduction(expected);
}

async function verifyPreviewStoreIdentity(input: {
  client: MigrationClient;
  dependencies: MigrationRunnerDependencies;
  environment: MigrationEnvironment;
}): Promise<void> {
  if (!isPreview(input.environment)) return;

  const identity = await (input.dependencies.readPreviewStoreIdentity ?? readPreviewStoreIdentity)(
    input.client,
  );

  const expected = input.environment.LOOPWORKS_EXPECTED_STORE_ID?.trim();
  if (
    !expected ||
    identity.status !== "present" ||
    identity.storeId.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error("Preview database identity did not match LOOPWORKS_EXPECTED_STORE_ID.");
  }
}

export async function runMigrations(
  environment: MigrationEnvironment = process.env,
  dependencies: MigrationRunnerDependencies = defaultDependencies,
): Promise<void> {
  const lease = await (dependencies.assertPreviewMigrationLease ?? assertPreviewMigrationLease)(
    environment,
  );
  const skipMigration =
    lease.status === "unassociated_preview" || lease.status === "non_database_preview";
  assertPreviewExpectedStoreIdentity(environment);
  const databaseUrl = resolveMigrationDatabaseUrl(environment);
  const client = dependencies.createClient(databaseUrl);
  let lockAcquired = false;

  try {
    await verifyPreviewStoreIdentity({
      client,
      dependencies,
      environment,
    });
    if (skipMigration) return;
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
    if (Bun.argv.length !== 2) {
      throw new Error("Usage: bun run db:migrate");
    }
    await runMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Database migration failed.");
    process.exitCode = 1;
  }
}
