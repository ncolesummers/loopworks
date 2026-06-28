import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

export type PgliteTestDatabase = {
  client: PGlite;
  db: PgliteDatabase<typeof schema>;
  close: () => Promise<void>;
};

/**
 * Spins up an isolated, in-memory PGlite (Postgres-in-WASM) database with the
 * full Drizzle schema applied via the generated migrations. Each call returns a
 * fresh database so integration tests stay deterministic and self-contained
 * without any external Postgres service.
 */
export async function createPgliteTestDatabase(): Promise<PgliteTestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });

  return {
    client,
    db,
    close: () => client.close(),
  };
}
