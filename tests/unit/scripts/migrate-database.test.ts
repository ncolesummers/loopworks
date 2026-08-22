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
    assertPreviewMigrationLease: vi.fn(async () => ({ status: "admitted" }) as const),
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

  it("refuses a Preview target with another store identity before migration", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    dependencies.readPreviewStoreIdentity = vi.fn(
      async () =>
        ({
          status: "present",
          storeId: "018f7c2e-0000-7c3d-9e4f-2a6b8c0d1e2f",
        }) as const,
    );

    await expect(
      runMigrations(
        {
          DATABASE_URL: "postgres://runtime:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
          DATABASE_URL_UNPOOLED:
            "postgres://migration:migration-secret@ep-preview.neon.tech/loopworks",
          LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
          VERCEL_ENV: "preview",
        },
        dependencies,
      ),
    ).rejects.toThrow(/Preview database identity/);

    await expect(
      runMigrations(
        {
          DATABASE_URL: "postgres://runtime:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
          DATABASE_URL_UNPOOLED:
            "postgres://migration:migration-secret@ep-preview.neon.tech/loopworks",
          LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
          VERCEL_ENV: "preview",
        },
        dependencies,
      ),
    ).rejects.not.toThrow(/runtime-secret|migration-secret/);
    expect(events).toEqual(["close", "close"]);
  });

  it("refuses an unprovisioned Preview root before migration", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);
    dependencies.readPreviewStoreIdentity = vi.fn(
      async () => ({ status: "missing_table" }) as const,
    );

    await expect(
      runMigrations(
        {
          DATABASE_URL: "postgres://runtime:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
          DATABASE_URL_UNPOOLED:
            "postgres://migration:migration-secret@ep-preview.neon.tech/loopworks",
          LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
          VERCEL_ENV: "preview",
        },
        dependencies,
      ),
    ).rejects.toThrow(/Preview database identity/);
    expect(events).toEqual(["close"]);
  });

  it("runs the Preview lease gate before opening a database connection", async () => {
    const events: string[] = [];
    const dependencies = createDependencies(events);

    dependencies.assertPreviewMigrationLease = vi.fn(async () => {
      throw new Error("Preview lease denied");
    });

    await expect(
      runMigrations(
        {
          DATABASE_URL: "postgres://runtime:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
          DATABASE_URL_UNPOOLED:
            "postgres://migration:migration-secret@ep-preview.neon.tech/loopworks",
          LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
          VERCEL_ENV: "preview",
        },
        dependencies,
      ),
    ).rejects.toThrow("Preview lease denied");
    expect(dependencies.createClient).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it.each(["unassociated_preview", "non_database_preview"] as const)(
    "verifies identity but skips advisory lock and migration for %s",
    async (status) => {
      const events: string[] = [];
      const dependencies = createDependencies(events);
      dependencies.assertPreviewMigrationLease = vi.fn(async () => ({ status }) as const);
      dependencies.readPreviewStoreIdentity = vi.fn(
        async () =>
          ({ status: "present", storeId: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f" }) as const,
      );
      await runMigrations(
        {
          DATABASE_URL: "postgres://runtime:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
          DATABASE_URL_UNPOOLED:
            "postgres://migration:migration-secret@ep-preview.neon.tech/loopworks",
          LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
          VERCEL_ENV: "preview",
        },
        dependencies,
      );
      expect(dependencies.createClient).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["close"]);
      expect(dependencies.migrateDatabase).not.toHaveBeenCalled();
    },
  );
});
