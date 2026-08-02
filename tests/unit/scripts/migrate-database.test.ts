import { readFileSync } from "node:fs";

import { type MigrationRunnerDependencies, runMigrations } from "../../../scripts/migrate-database";

function createDependencies(events: string[]): MigrationRunnerDependencies {
  const client = {
    unsafe: vi.fn(async (query: string) => {
      events.push(query.includes("unlock") ? "unlock" : "lock");
      return [];
    }),
    end: vi.fn(async () => {
      events.push("close");
    }),
  } as unknown as ReturnType<MigrationRunnerDependencies["createClient"]>;

  return {
    createClient: vi.fn(() => client),
    migrateDatabase: vi.fn(async () => {
      events.push("migrate");
    }),
  };
}

describe("database migration runner", () => {
  it("backs db:migrate with the repository-owned runner", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["db:migrate"]).toBe("bun run scripts/migrate-database.ts");
  });

  it("holds one database advisory lock around migration execution", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    const directUrl = "postgres://user:secret@127.0.0.1:5432/loopworks";

    await runMigrations(
      {
        DATABASE_URL: directUrl,
        DATABASE_URL_UNPOOLED: directUrl,
      },
      dependencies,
    );

    expect(dependencies.createClient).toHaveBeenCalledWith(directUrl);
    expect(events).toEqual(["lock", "migrate", "unlock", "close"]);
  });

  it("releases the advisory lock and closes the connection when migration fails", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    vi.mocked(dependencies.migrateDatabase).mockImplementationOnce(async () => {
      events.push("migrate");
      throw new Error("migration failed");
    });

    await expect(
      runMigrations(
        {
          DATABASE_URL: "postgres://user:secret@127.0.0.1:5432/loopworks",
          DATABASE_URL_UNPOOLED: "postgres://user:secret@127.0.0.1:5432/loopworks",
        },
        dependencies,
      ),
    ).rejects.toThrow("migration failed");

    expect(events).toEqual(["lock", "migrate", "unlock", "close"]);
  });
});
