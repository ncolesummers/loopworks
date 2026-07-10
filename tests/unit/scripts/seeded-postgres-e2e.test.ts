import { readFileSync } from "node:fs";

import fallbackPlaywrightConfig from "../../../playwright.config";
import seededPlaywrightConfig from "../../../playwright.seeded.config";
import { getLocalDatabaseSafetyError } from "../../../scripts/local-database-safety";
import { runSeededPostgresE2e } from "../../../scripts/test-seeded-postgres";

const seededDatabaseUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e";

describe("seeded Postgres e2e orchestration", () => {
  it("is exposed as a separate package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["test:e2e"]).toBe("playwright test");
    expect(packageJson.scripts?.["test:e2e:seeded"]).toBe(
      "bun run scripts/test-seeded-postgres.ts",
    );
  });

  it("runs migration, reset seed, and seeded Playwright in order", async () => {
    const commands: string[][] = [];

    const exitCode = await runSeededPostgresE2e({
      env: { DATABASE_URL: seededDatabaseUrl, NODE_ENV: "development" },
      runCommand: async (command) => {
        commands.push([...command]);
        return 0;
      },
    });

    expect(exitCode).toBe(0);
    expect(commands).toEqual([
      ["bun", "run", "db:migrate"],
      ["bun", "run", "db:seed:reset"],
      ["bunx", "playwright", "test", "--config=playwright.seeded.config.ts"],
    ]);
  });

  it.each([
    ["missing DATABASE_URL", { NODE_ENV: "development" }],
    ["production runtime", { DATABASE_URL: seededDatabaseUrl, NODE_ENV: "production" }],
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
    [
      "percent-encoded database alias",
      {
        DATABASE_URL: "postgres://admin:hunter2@127.0.0.1:5432/loopworks%5fe2e",
        NODE_ENV: "development",
      },
    ],
    [
      "malformed percent-encoding",
      {
        DATABASE_URL: "postgres://admin:hunter2@127.0.0.1:5432/%E0%A4%A",
        NODE_ENV: "development",
      },
    ],
  ] satisfies [
    string,
    Partial<NodeJS.ProcessEnv>,
  ][])("rejects %s before running commands without leaking credentials", async (_label, env) => {
    const runCommand = vi.fn(async () => 0);
    const errors: string[] = [];

    const exitCode = await runSeededPostgresE2e({
      env,
      error: (message) => errors.push(message),
      runCommand,
    });

    expect(exitCode).toBe(1);
    expect(runCommand).not.toHaveBeenCalled();
    expect(errors.join(" ")).not.toContain("hunter2");
    expect(errors.join(" ")).not.toContain("admin:");
  });

  it.each([
    ["migration", [1], 1],
    ["seed", [0, 1], 2],
    ["Playwright", [0, 0, 1], 3],
  ])("stops after a %s stage failure", async (stage, results, expectedCalls) => {
    const errors: string[] = [];
    const runCommand = vi.fn(async () => results[runCommand.mock.calls.length - 1] ?? 0);

    const exitCode = await runSeededPostgresE2e({
      env: { DATABASE_URL: seededDatabaseUrl, NODE_ENV: "development" },
      error: (message) => errors.push(message),
      runCommand,
    });

    expect(exitCode).toBe(1);
    expect(runCommand).toHaveBeenCalledTimes(expectedCalls);
    expect(errors.join(" ")).toContain(stage);
    expect(errors.join(" ")).not.toContain(seededDatabaseUrl);
  });

  it("keeps the generic seed guard local without requiring the e2e database name", () => {
    expect(
      getLocalDatabaseSafetyError(
        {
          DATABASE_URL: "postgres://loopworks:loopworks@localhost:5432/loopworks",
          NODE_ENV: "development",
        },
        { requireExplicitUrl: true },
      ),
    ).toBeNull();
  });

  it("keeps fallback and seeded Playwright servers isolated", () => {
    const fallbackServer = fallbackPlaywrightConfig.webServer;
    const seededServer = seededPlaywrightConfig.webServer;

    expect(Array.isArray(fallbackServer)).toBe(false);
    expect(Array.isArray(seededServer)).toBe(false);
    expect(fallbackServer).toMatchObject({
      reuseExistingServer: false,
      env: {
        LOOPWORKS_PORTAL_DATA_MODE: "fixtures",
      },
    });
    expect(seededServer).toMatchObject({
      reuseExistingServer: false,
      env: {
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        LOOPWORKS_PORTAL_DATA_MODE: "",
      },
    });
  });
});
