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
    // Measurement only (#118). Thresholds and the CI wiring land in #120, and
    // only ever on this default lane — the Postgres lane stays uninstrumented.
    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./coverage",
      // Vitest 4 reports every file matching `include`, so untested files count
      // as zero rather than vanishing — the baseline reflects the real surface
      // the audit in #119 ranks gaps against. (The old `all` flag is gone.)
      include: ["src/**/*.{ts,tsx}", "agent/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx,mjs}"],
      exclude: [
        "**/*.d.ts",
        "**/*.config.{ts,mts,js,mjs}",
        "**/*.stories.tsx",
        "**/__fixtures__/**",
        "**/fixtures/**",
        "**/node_modules/**",
        ".next/**",
        ".storybook/**",
        "agent/**/*-fixture.ts",
        "coverage/**",
        "drizzle/**",
        "evals/**",
        "playwright-report/**",
        "src/stories/**",
        "src/types/**",
        "storybook-static/**",
        "test-results/**",
        "tests/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@agent": path.resolve(__dirname, "./agent"),
    },
  },
});
