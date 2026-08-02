import { readFileSync } from "node:fs";

const migrationEnvironmentKeys = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_BRANCH_ID",
  "NEON_DATABASE_NAME",
  "NEON_DATABASE_USERNAME",
  "NEON_PROJECT_ID",
  "PGHOST",
  "POSTGRES_HOST",
  "VERCEL_ENV",
] as const;

type MigrationEnvironment = Partial<Record<(typeof migrationEnvironmentKeys)[number], string>>;

async function loadMigrationUrl(environment: MigrationEnvironment): Promise<string> {
  for (const key of migrationEnvironmentKeys) {
    vi.stubEnv(key, environment[key]);
  }
  vi.resetModules();

  const { default: config } = await import("../../../drizzle.config");
  const credentials = (config as unknown as { dbCredentials?: { url: string } }).dbCredentials;

  if (!credentials) {
    throw new Error("Expected Drizzle database credentials.");
  }

  return credentials.url;
}

describe("Neon migration configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the direct URL for migrations when both Neon URLs are available", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://pooled-user:pooled-secret@ep-example-pooler.neon.tech/loopworks",
        DATABASE_URL_UNPOOLED:
          "postgres://direct-user:direct-secret@ep-example.neon.tech/loopworks",
        VERCEL_ENV: "production",
      }),
    ).resolves.toBe("postgres://direct-user:direct-secret@ep-example.neon.tech/loopworks");
  });

  it("rejects a pooled Neon endpoint in the direct variable", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://user:runtime-secret@ep-example-pooler.neon.tech/loopworks",
        DATABASE_URL_UNPOOLED:
          "postgres://user:migration-secret@ep-example-pooler.neon.tech/loopworks",
        VERCEL_ENV: "production",
      }),
    ).rejects.toThrow("DATABASE_URL_UNPOOLED");
  });

  it("rejects a direct Neon endpoint in the pooled runtime variable", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://user:runtime-secret@ep-example.neon.tech/loopworks",
        DATABASE_URL_UNPOOLED: "postgres://user:migration-secret@ep-example.neon.tech/loopworks",
        VERCEL_ENV: "production",
      }),
    ).rejects.toThrow("pooled Neon endpoint");
  });

  it("rejects mismatched Neon runtime and migration branches", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://user:runtime-secret@ep-preview-pooler.neon.tech/loopworks",
        DATABASE_URL_UNPOOLED: "postgres://user:migration-secret@ep-production.neon.tech/loopworks",
        VERCEL_ENV: "preview",
      }),
    ).rejects.toThrow("same Neon branch");
  });

  it("rejects mismatched databases on the same Neon branch", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://user:runtime-secret@ep-preview-pooler.neon.tech/runtime_db",
        DATABASE_URL_UNPOOLED:
          "postgres://user:migration-secret@ep-preview.neon.tech/production_db",
        VERCEL_ENV: "preview",
      }),
    ).rejects.toThrow("same Neon branch and database");
  });

  it("fails closed when a hosted migration has no pooled runtime URL", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL_UNPOOLED:
          "postgres://direct-user:direct-secret@ep-production.neon.tech/loopworks",
        VERCEL_ENV: "production",
      }),
    ).rejects.toThrow("DATABASE_URL");
  });

  it("rejects malformed direct URLs without exposing their credentials", async () => {
    const migrationUrl = loadMigrationUrl({
      DATABASE_URL: "postgres://user:runtime-secret@ep-example-pooler.neon.tech/loopworks",
      DATABASE_URL_UNPOOLED: "postgres://migration-user:migration-super-secret@bad host/loopworks",
      VERCEL_ENV: "production",
    });

    await expect(migrationUrl).rejects.toThrow("DATABASE_URL_UNPOOLED");
    await expect(migrationUrl).rejects.not.toThrow("migration-super-secret");
    await expect(migrationUrl).rejects.not.toThrow("postgres://");
  });

  it.each([
    "production",
    "preview",
  ])("fails closed in the Vercel %s environment when the direct URL is missing", async (vercelEnvironment) => {
    const migrationUrl = loadMigrationUrl({
      DATABASE_URL: "postgres://pooled-user:super-secret@pooler.neon.tech/loopworks",
      DATABASE_URL_UNPOOLED: "   ",
      VERCEL_ENV: vercelEnvironment,
    });

    await expect(migrationUrl).rejects.toThrow("DATABASE_URL_UNPOOLED");
    await expect(migrationUrl).rejects.not.toThrow("super-secret");
    await expect(migrationUrl).rejects.not.toThrow("postgres://");
  });

  it.each([
    ["NEON_PROJECT_ID", "project-id"],
    ["NEON_BRANCH_ID", "branch-id"],
    ["NEON_DATABASE_NAME", "loopworks"],
    ["NEON_DATABASE_USERNAME", "loopworks_owner"],
    ["PGHOST", "ep-example.us-west-2.aws.neon.tech"],
    ["POSTGRES_HOST", "ep-example.us-west-2.aws.neon.tech"],
  ] as const)("fails closed when hosted Neon metadata %s is present", async (key, value) => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://pooled-user:super-secret@db.example.com/loopworks",
        [key]: value,
      }),
    ).rejects.toThrow("DATABASE_URL_UNPOOLED");
  });

  it("fails closed when the pooled URL itself identifies Neon", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://pooled-user:super-secret@pooler.neon.tech/loopworks",
      }),
    ).rejects.toThrow("DATABASE_URL_UNPOOLED");
  });

  it("allows the pooled URL fallback for local development", async () => {
    await expect(
      loadMigrationUrl({
        DATABASE_URL: "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks",
        VERCEL_ENV: "development",
      }),
    ).resolves.toBe("postgres://loopworks:loopworks@127.0.0.1:5432/loopworks");
  });

  it("uses the loopback default only when no hosted database configuration is present", async () => {
    await expect(loadMigrationUrl({})).resolves.toBe(
      "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks",
    );
  });

  it("runs migrations before the application build on Vercel", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["vercel-build"]).toBe("bun run db:migrate && bun run build");
  });
});
