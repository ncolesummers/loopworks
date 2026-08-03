import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { readStringConfig } from "@/lib/config/registry";

const databaseUrl = readStringConfig("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL (database): value is required");

const globalForDatabase = globalThis as typeof globalThis & {
  loopworksPostgresClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.loopworksPostgresClient ??
  postgres(databaseUrl, {
    prepare: false,
  });

if (readStringConfig("NODE_ENV") !== "production") {
  globalForDatabase.loopworksPostgresClient = client;
}

export const db = drizzle(client, { schema });
