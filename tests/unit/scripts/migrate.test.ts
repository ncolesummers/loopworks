import { readFileSync } from "node:fs";
import path from "node:path";

import {
  type DatabaseMigrationConnection,
  DEFAULT_DATABASE_URL,
  runDatabaseMigrations,
} from "../../../scripts/migrate";

function connection(): DatabaseMigrationConnection & { close: ReturnType<typeof vi.fn> } {
  return {
    close: vi.fn(async () => {}),
    database: {} as DatabaseMigrationConnection["database"],
  };
}

describe("database migration command", () => {
  it("is the canonical db:migrate package command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["db:migrate"]).toBe("bun run scripts/migrate.ts");
  });

  it.each([
    ["the explicit URL", "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e"],
    ["the compatible local default", undefined],
  ])("migrates with %s and always closes the connection", async (_label, databaseUrl) => {
    const opened = connection();
    const connect = vi.fn(() => opened);
    const migrate = vi.fn(async () => {});

    const exitCode = await runDatabaseMigrations({
      connect,
      env: databaseUrl ? { DATABASE_URL: databaseUrl } : {},
      migrate,
    });

    expect(exitCode).toBe(0);
    expect(connect).toHaveBeenCalledWith(databaseUrl ?? DEFAULT_DATABASE_URL);
    expect(migrate).toHaveBeenCalledWith(opened.database, {
      migrationsFolder: path.resolve("drizzle"),
    });
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it("preserves drizzle-kit's --config migration behavior", async () => {
    const opened = connection();
    const connect = vi.fn(() => opened);
    const migrate = vi.fn(async () => {});
    const loadConfig = vi.fn(async () => ({
      database: "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_staging",
      migrationsFolder: "drizzle-staging",
      migrationsSchema: "staging_migrations",
      migrationsTable: "history",
    }));

    const exitCode = await runDatabaseMigrations({
      args: ["--", "--config", "drizzle.staging.config.ts"],
      connect,
      env: {},
      loadConfig,
      migrate,
    });

    expect(exitCode).toBe(0);
    expect(loadConfig).toHaveBeenCalledWith(path.resolve("drizzle.staging.config.ts"));
    expect(connect).toHaveBeenCalledWith(
      "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_staging",
    );
    expect(migrate).toHaveBeenCalledWith(opened.database, {
      migrationsFolder: path.resolve("drizzle-staging"),
      migrationsSchema: "staging_migrations",
      migrationsTable: "history",
    });
    expect(opened.close).toHaveBeenCalledOnce();
  });

  it("reports a credential-safe failure and closes the connection", async () => {
    const databaseUrl = "postgres://admin:hunter2@127.0.0.1:5432/loopworks_e2e";
    const opened = connection();
    const errors: string[] = [];

    const exitCode = await runDatabaseMigrations({
      connect: () => opened,
      env: { DATABASE_URL: databaseUrl },
      error: (message) => errors.push(message),
      migrate: async () => {
        throw new Error(`connection failed for ${databaseUrl}`);
      },
    });

    expect(exitCode).toBe(1);
    expect(opened.close).toHaveBeenCalledOnce();
    expect(errors).toEqual(["Database migration failed (Error)."]);
    expect(errors.join(" ")).not.toContain("hunter2");
    expect(errors.join(" ")).not.toContain("admin:");
  });
});
