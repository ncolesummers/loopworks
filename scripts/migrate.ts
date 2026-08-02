import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Config } from "drizzle-kit";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  applyPostgresMigrations,
  type PostgresMigrationDatabase,
  PostgresMigrationError,
} from "../src/db/migrations";

export const DEFAULT_DATABASE_URL = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

export type DatabaseMigrationConnection = {
  close: () => Promise<void>;
  database: PostgresMigrationDatabase<Record<string, never>>;
};

export type DatabaseConnectionConfig = string | Record<string, unknown>;

export type LoadedMigrationConfig = {
  database: DatabaseConnectionConfig;
  migrationsFolder: string;
  migrationsSchema?: string;
  migrationsTable?: string;
};

export type DatabaseMigrationDependencies = {
  args?: string[];
  connect?: (database: DatabaseConnectionConfig) => DatabaseMigrationConnection;
  env?: Partial<NodeJS.ProcessEnv>;
  error?: (message: string) => void;
  loadConfig?: (configPath: string) => Promise<LoadedMigrationConfig>;
  migrate?: typeof applyPostgresMigrations;
};

function connect(database: DatabaseConnectionConfig): DatabaseMigrationConnection {
  const options = {
    max: 1,
    onnotice: () => {},
    prepare: false,
  };
  const client =
    typeof database === "string"
      ? postgres(database, options)
      : postgres({ ...database, ...options } as postgres.Options<Record<string, never>>);
  return {
    close: () => client.end(),
    database: drizzle(client),
  };
}

function resolveConfigPath(args: string[]): string {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.length === 0) return path.resolve("drizzle.config.ts");
  if (normalized.length === 2 && normalized[0] === "--config" && normalized[1]) {
    return path.resolve(normalized[1]);
  }
  if (normalized.length === 1 && normalized[0]?.startsWith("--config=")) {
    const configPath = normalized[0].slice("--config=".length);
    if (configPath) return path.resolve(configPath);
  }
  throw new Error("Usage: bun run db:migrate -- --config <path>");
}

async function loadConfig(configPath: string): Promise<LoadedMigrationConfig> {
  const imported = (await import(pathToFileURL(configPath).href)) as { default?: Config };
  const config = imported.default;
  if (config?.dialect !== "postgresql" || !("dbCredentials" in config)) {
    throw new Error("Migration config must use the PostgreSQL dialect.");
  }

  const credentials = config.dbCredentials;
  if (!("url" in credentials) && !("host" in credentials)) {
    throw new Error("Migration config must use PostgreSQL URL or host credentials.");
  }

  return {
    database: "url" in credentials ? credentials.url : credentials,
    migrationsFolder: config.out ?? "drizzle",
    migrationsSchema: config.migrations?.schema,
    migrationsTable: config.migrations?.table,
  };
}

function migrationFailureMessage(error: unknown): string {
  if (error instanceof PostgresMigrationError) {
    const code = error.code ? `; code=${error.code}` : "";
    return `Database migration failed (journal=${error.folderMillis}; hash=${error.migrationHash.slice(0, 12)}${code}).`;
  }
  const name = error instanceof Error && error.name ? error.name : "unknown error";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? `; code=${String(error.code)}`
      : "";
  return `Database migration failed (${name}${code}).`;
}

export async function runDatabaseMigrations(
  dependencies: DatabaseMigrationDependencies = {},
): Promise<number> {
  const args = dependencies.args ?? process.argv.slice(2);
  const env = dependencies.env ?? process.env;
  const reportError = dependencies.error ?? console.error;
  const openConnection = dependencies.connect ?? connect;
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const migrate = dependencies.migrate ?? applyPostgresMigrations;
  let connection: DatabaseMigrationConnection | undefined;
  let failed = false;

  try {
    const config = await readConfig(resolveConfigPath(args));
    connection = openConnection(env.DATABASE_URL ?? config.database ?? DEFAULT_DATABASE_URL);
    await migrate(connection.database, {
      migrationsFolder: path.resolve(config.migrationsFolder),
      ...(config.migrationsSchema ? { migrationsSchema: config.migrationsSchema } : {}),
      ...(config.migrationsTable ? { migrationsTable: config.migrationsTable } : {}),
    });
  } catch (error) {
    failed = true;
    reportError(migrationFailureMessage(error));
  } finally {
    try {
      await connection?.close();
    } catch (error) {
      if (!failed) reportError(migrationFailureMessage(error));
      failed = true;
    }
  }

  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await runDatabaseMigrations();
}
