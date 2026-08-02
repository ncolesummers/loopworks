import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The native PostgreSQL lane. Unlike the default PGlite-backed suite, these tests
 * require a live local Postgres so they can prove cross-session lock scheduling.
 * Run them with `bun run test:integration:postgres`.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/integration/postgres/**/*.{test,spec}.{ts,tsx}"],
    // Generous enough that a genuine lock-wait failure surfaces the helper's
    // explicit diagnostic instead of an opaque Vitest timeout.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Sessions contend on shared rows in one database, so files must not overlap.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@agent": path.resolve(__dirname, "./agent"),
    },
  },
});
