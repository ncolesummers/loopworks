import { readFileSync } from "node:fs";
import { runNativePostgresTests } from "../../../scripts/test-native-postgres";
import defaultVitestConfig from "../../../vitest.config";
import nativePostgresConfig from "../../../vitest.postgres.config";

const nativeDatabaseUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e";

describe("native Postgres admission lane orchestration", () => {
  it("is exposed as a separate package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:integration:postgres"]).toBe(
      "bun run scripts/test-native-postgres.ts",
    );
  });

  it("runs the native Postgres Vitest config", async () => {
    const commands: string[][] = [];

    const exitCode = await runNativePostgresTests({
      env: { DATABASE_URL: nativeDatabaseUrl, NODE_ENV: "development" },
      runCommand: async (command) => {
        commands.push([...command]);
        return 0;
      },
    });

    expect(exitCode).toBe(0);
    expect(commands).toEqual([["bunx", "vitest", "run", "--config=vitest.postgres.config.ts"]]);
  });

  it.each([
    ["missing DATABASE_URL", { NODE_ENV: "development" }],
    ["production runtime", { DATABASE_URL: nativeDatabaseUrl, NODE_ENV: "production" }],
    ["malformed URL", { DATABASE_URL: "not a url", NODE_ENV: "development" }],
    ["wrong scheme", { DATABASE_URL: "https://127.0.0.1/loopworks_e2e", NODE_ENV: "development" }],
    [
      "non-loopback host",
      {
        DATABASE_URL: "postgres://admin:hunter2@prod-db.example.com/loopworks_e2e",
        NODE_ENV: "development",
      },
    ],
    [
      "wrong database",
      {
        DATABASE_URL: "postgres://admin:hunter2@127.0.0.1:5432/loopworks",
        NODE_ENV: "development",
      },
    ],
  ] satisfies [string, Partial<NodeJS.ProcessEnv>][])(
    "fails closed on %s without leaking credentials",
    async (_label, env) => {
      const runCommand = vi.fn(async () => 0);
      const errors: string[] = [];

      const exitCode = await runNativePostgresTests({
        env,
        error: (m) => errors.push(m),
        runCommand,
      });

      // Fails closed: a non-zero exit, never a skip and never a PGlite fallback.
      expect(exitCode).toBe(1);
      expect(runCommand).not.toHaveBeenCalled();
      expect(errors.join(" ")).not.toContain("hunter2");
      expect(errors.join(" ")).not.toContain("admin:");
    },
  );

  it("reports a failing lane instead of masking it", async () => {
    const errors: string[] = [];

    const exitCode = await runNativePostgresTests({
      env: { DATABASE_URL: nativeDatabaseUrl, NODE_ENV: "development" },
      error: (message) => errors.push(message),
      runCommand: async () => 1,
    });

    expect(exitCode).toBe(1);
    expect(errors.join(" ")).toContain("Native Postgres admission lane failed");
    expect(errors.join(" ")).not.toContain(nativeDatabaseUrl);
  });

  it("keeps the native lane out of the default PGlite-backed suite", () => {
    expect(defaultVitestConfig.test?.exclude).toContain("tests/integration/postgres/**");
    expect(nativePostgresConfig.test?.include).toEqual([
      "tests/integration/postgres/**/*.{test,spec}.{ts,tsx}",
    ]);
    // Shared rows in one database mean lane files must not run in parallel.
    expect(nativePostgresConfig.test?.fileParallelism).toBe(false);
  });
});
