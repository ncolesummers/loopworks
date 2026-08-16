#!/usr/bin/env bun

import path from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

import { localDatabaseUrl } from "@/lib/config/registry";
import { classifyDatabaseError, databaseFailureMessage } from "./database-errors";
import { resolveLocalDatabaseTarget } from "./local-database-safety";

export type MigrationStatus = "current" | "incompatible" | "pending";

export type MigrationIdentity = { createdAt: number; hash: string };

type DoctorClient = {
  unsafe: (query: string) => Promise<unknown[]>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

export type DatabaseDoctorDependencies = {
  createClient: (databaseUrl: string) => DoctorClient;
  error: (message: string) => void;
  log: (message: string) => void;
  readMigrations: () => { folderMillis: number; hash: string }[];
};

const defaultDependencies: DatabaseDoctorDependencies = {
  createClient: (databaseUrl) =>
    postgres(databaseUrl, {
      max: 1,
      onnotice: () => {},
      prepare: false,
    }) as unknown as DoctorClient,
  error: (message) => console.error(message),
  log: (message) => console.log(message),
  readMigrations: () => readMigrationFiles({ migrationsFolder: path.resolve("drizzle") }),
};

export function getMigrationStatus(
  expected: MigrationIdentity[],
  applied: MigrationIdentity[],
): MigrationStatus {
  const prefixMatches = applied.every(
    (migration, index) =>
      expected[index]?.hash === migration.hash &&
      expected[index]?.createdAt === migration.createdAt,
  );
  if (!prefixMatches || applied.length > expected.length) return "incompatible";
  return applied.length === expected.length ? "current" : "pending";
}

async function diagnoseDatabase(
  client: DoctorClient,
  target: { databaseName: string; username: string },
  dependencies: DatabaseDoctorDependencies,
): Promise<number> {
  let identity: { database: string; username: string } | undefined;
  try {
    [identity] = (await client.unsafe(`
      SELECT current_user AS username, current_database() AS database
    `)) as { database: string; username: string }[];
  } catch (error) {
    dependencies.error(
      `Reachability: fail. ${databaseFailureMessage(classifyDatabaseError(error), "doctor")}`,
    );
    return 1;
  }
  dependencies.log("Reachability: pass.");
  if (identity?.username !== target.username || identity.database !== target.databaseName) {
    dependencies.error(
      "Identity: fail. The connected role or database differs from the URL target.",
    );
    return 1;
  }
  dependencies.log("Identity: pass.");

  try {
    const [table] = (await client.unsafe(`
      SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "migrationTable"
    `)) as { migrationTable: string | null }[];
    let applied: MigrationIdentity[] = [];
    if (table?.migrationTable) {
      const rows = (await client.unsafe(`
        SELECT hash, created_at AS "createdAt"
        FROM drizzle.__drizzle_migrations
        ORDER BY created_at, id
      `)) as { createdAt: number | string; hash: string }[];
      applied = rows.map(({ createdAt, hash }) => ({ createdAt: Number(createdAt), hash }));
    }
    const expected = dependencies
      .readMigrations()
      .map(({ folderMillis, hash }) => ({ createdAt: folderMillis, hash }));
    const status = getMigrationStatus(expected, applied);
    if (status !== "current") {
      dependencies.error(`Migrations: fail (${status}). Run 'bun run db:migrate', then retry.`);
      return 1;
    }
    dependencies.log("Migrations: pass (exactly current).");
    return 0;
  } catch (error) {
    dependencies.error(
      `Migrations: fail. ${databaseFailureMessage(classifyDatabaseError(error), "doctor")}`,
    );
    return 1;
  }
}

export async function runDatabaseDoctor(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  dependencies: DatabaseDoctorDependencies = defaultDependencies,
): Promise<number> {
  const resolution = resolveLocalDatabaseTarget(env, { defaultUrl: localDatabaseUrl });
  if (resolution.error || !resolution.target) {
    dependencies.error(
      `URL safety: fail. ${resolution.error ?? "No database target is configured."}`,
    );
    return 1;
  }
  dependencies.log("URL safety: pass.");

  let client: DoctorClient;
  try {
    client = dependencies.createClient(resolution.target.url);
  } catch (error) {
    dependencies.error(
      `Reachability: fail. ${databaseFailureMessage(classifyDatabaseError(error), "doctor")}`,
    );
    return 1;
  }
  const exitCode = await diagnoseDatabase(client, resolution.target, dependencies);
  try {
    await client.end({ timeout: 5 });
  } catch (cleanupError) {
    dependencies.error(
      `Database doctor cleanup failed. ${databaseFailureMessage(
        classifyDatabaseError(cleanupError),
        "doctor",
      )}`,
    );
    return 1;
  }
  return exitCode;
}

if (import.meta.main) process.exitCode = await runDatabaseDoctor();
