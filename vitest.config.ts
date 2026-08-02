import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    // The native Postgres lane needs a live database; it runs via
    // `bun run test:integration:postgres`, not the default PGlite-backed suite.
    exclude: ["tests/e2e/**", "tests/integration/postgres/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@agent": path.resolve(__dirname, "./agent"),
    },
  },
});
