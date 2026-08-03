import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

export type PgliteTestDatabase = {
  client: PGlite;
  db: PgliteDatabase<typeof schema>;
  close: () => Promise<void>;
  reset: () => Promise<void>;
};

export const pgliteTestHookTimeoutMs = 30_000;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Spins up an isolated, in-memory PGlite (Postgres-in-WASM) database with the
 * full Drizzle schema applied via the generated migrations. `reset` truncates
 * migrated public tables while preserving Drizzle's migration metadata. It is
 * intended for beforeEach cleanup when a test file reuses one migrated database.
 */
export async function createPgliteTestDatabase(): Promise<PgliteTestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  const publicTables = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const resetStatement = `TRUNCATE TABLE ${publicTables.rows
    .map(({ tablename }) => quoteIdentifier(tablename))
    .join(", ")} RESTART IDENTITY CASCADE`;

  return {
    client,
    db,
    close: () => client.close(),
    reset: async () => {
      await client.exec(resetStatement);
    },
  };
}
