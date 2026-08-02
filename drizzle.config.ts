import { defineConfig } from "drizzle-kit";

import { resolveMigrationDatabaseUrl } from "./src/db/neon-migration-config";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: resolveMigrationDatabaseUrl(process.env),
  },
});
