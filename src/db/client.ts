import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

const globalForDatabase = globalThis as typeof globalThis & {
  loopworksPostgresClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.loopworksPostgresClient ??
  postgres(databaseUrl, {
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.loopworksPostgresClient = client;
}

export const db = drizzle(client, { schema });
