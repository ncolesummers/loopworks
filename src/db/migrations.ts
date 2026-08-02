import { type MigrationConfig, readMigrationFiles } from "drizzle-orm/migrator";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

const MIGRATION_ADVISORY_LOCK_KEY = 113_2026;

type MigrationRecord = {
  created_at: string;
  hash: string;
  id: number;
};

export type PostgresMigrationDatabase<TSchema extends Record<string, unknown>> =
  PostgresJsDatabase<TSchema> & {
    $client: postgres.Sql;
  };

export class PostgresMigrationError extends Error {
  readonly code?: string;
  readonly folderMillis: number;
  readonly migrationHash: string;

  constructor(migration: { folderMillis: number; hash: string }, cause: unknown) {
    super(`PostgreSQL migration ${migration.folderMillis} failed.`, { cause });
    this.name = "PostgresMigrationError";
    this.code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : undefined;
    this.folderMillis = migration.folderMillis;
    this.migrationHash = migration.hash;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function applyPendingMigrations(
  connection: postgres.ReservedSql,
  config: MigrationConfig,
): Promise<void> {
  const migrations = readMigrationFiles(config);
  const migrationsSchema = config.migrationsSchema ?? "drizzle";
  const migrationsTable = config.migrationsTable ?? "__drizzle_migrations";

  const qualifiedMigrationsTable = `${quoteIdentifier(migrationsSchema)}.${quoteIdentifier(
    migrationsTable,
  )}`;

  await connection.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(migrationsSchema)}`);
  await connection.unsafe(`
    CREATE TABLE IF NOT EXISTS ${qualifiedMigrationsTable} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const applied = await connection.unsafe<MigrationRecord[]>(`
    SELECT id, hash, created_at
    FROM ${qualifiedMigrationsTable}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const lastApplied = applied[0];

  for (const migration of migrations) {
    if (lastApplied && Number(lastApplied.created_at) >= migration.folderMillis) continue;

    try {
      await connection.unsafe("BEGIN");
      try {
        for (const statement of migration.sql) {
          if (statement.trim().length === 0) continue;
          await connection.unsafe(statement);
        }
        await connection.unsafe(
          `INSERT INTO ${qualifiedMigrationsTable} (hash, created_at) VALUES ($1, $2)`,
          [migration.hash, migration.folderMillis],
        );
        await connection.unsafe("COMMIT");
      } catch (error) {
        await connection.unsafe("ROLLBACK");
        throw error;
      }
    } catch (error) {
      throw new PostgresMigrationError(migration, error);
    }
  }
}

/**
 * Applies pending Drizzle migrations with one PostgreSQL transaction per file.
 *
 * PostgreSQL requires a newly-added enum label to commit before a later
 * migration can use it. Drizzle's PostgreSQL migrator wraps every pending file
 * in one transaction, so this preserves Drizzle's journal and bookkeeping
 * format while narrowing the transaction boundary to a single file.
 */
export async function applyPostgresMigrations<TSchema extends Record<string, unknown>>(
  database: PostgresMigrationDatabase<TSchema>,
  config: MigrationConfig,
): Promise<void> {
  const connection = await database.$client.reserve();
  let lockAcquired = false;

  try {
    await connection`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`;
    lockAcquired = true;
    await applyPendingMigrations(connection, config);
  } finally {
    try {
      if (lockAcquired) {
        await connection`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`;
      }
    } finally {
      connection.release();
    }
  }
}
