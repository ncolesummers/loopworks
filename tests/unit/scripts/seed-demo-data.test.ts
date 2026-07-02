import { readFileSync } from "node:fs";

import type { SeedCounts, SeedDatabase } from "@/lib/seed/demo-data";

import { runSeedCli } from "../../../scripts/seed-demo-data";

const fakeDatabase = {} as SeedDatabase;

function emptyCounts(): SeedCounts {
  return {
    repositories: 0,
    vercelProjects: 0,
    loops: 0,
    loopRuns: 0,
    runSteps: 0,
    artifacts: 0,
    approvals: 0,
    approvalTransitionEvents: 0,
    deployments: 0,
  };
}

describe("seed-demo-data CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is exposed through package scripts", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["db:seed"]).toBe("bun run scripts/seed-demo-data.ts");
    expect(packageJson.scripts?.["db:seed:reset"]).toBe(
      "bun run scripts/seed-demo-data.ts --reset",
    );
  });

  it("refuses to seed in production and never calls seedDemoData", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      [],
      { NODE_ENV: "production" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(1);
    expect(seedSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    const loggedMessages = errorSpy.mock.calls.flat().join(" ").toLowerCase();
    expect(loggedMessages).not.toContain("postgres://");
    expect(loggedMessages).not.toContain("database_url");
  });

  it("refuses to seed when VERCEL_ENV is production too", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      [],
      { VERCEL_ENV: "production" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(1);
    expect(seedSpy).not.toHaveBeenCalled();
  });

  it("refuses to seed when DATABASE_URL does not point at a loopback host, even outside production", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      [],
      {
        NODE_ENV: "development",
        DATABASE_URL: "postgres://admin:hunter2@prod-db.example.com:5432/loopworks",
      },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(1);
    expect(seedSpy).not.toHaveBeenCalled();

    const loggedMessages = errorSpy.mock.calls.flat().join(" ");
    expect(loggedMessages).not.toContain("hunter2");
    expect(loggedMessages).not.toContain("admin:hunter2");
  });

  it("allows seeding when DATABASE_URL points at 127.0.0.1 or localhost", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    vi.spyOn(console, "log").mockImplementation(() => {});

    const loopbackHosts = [
      "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks",
      "postgres://loopworks:loopworks@localhost:5432/loopworks",
    ];

    for (const databaseUrl of loopbackHosts) {
      seedSpy.mockClear();
      const exitCode = await runSeedCli(
        [],
        { NODE_ENV: "development", DATABASE_URL: databaseUrl },
        {
          seedDemoData: seedSpy,
          database: fakeDatabase,
        },
      );

      expect(exitCode).toBe(0);
      expect(seedSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("seeds successfully in a non-production environment", async () => {
    const seedSpy = vi.fn(async () => ({ ...emptyCounts(), repositories: 4 }));
    vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      [],
      { NODE_ENV: "development" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(0);
    expect(seedSpy).toHaveBeenCalledWith(fakeDatabase, { reset: false });
  });

  it("passes reset through when --reset is provided", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      ["--reset"],
      { NODE_ENV: "development" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(0);
    expect(seedSpy).toHaveBeenCalledWith(fakeDatabase, { reset: true });
  });

  it("dry-run prints planned counts without writing", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      ["--dry-run"],
      { NODE_ENV: "development" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(0);
    expect(seedSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
  });

  it("rejects unknown arguments without seeding", async () => {
    const seedSpy = vi.fn(async () => emptyCounts());
    vi.spyOn(console, "error").mockImplementation(() => {});

    const exitCode = await runSeedCli(
      ["--bogus"],
      { NODE_ENV: "development" },
      {
        seedDemoData: seedSpy,
        database: fakeDatabase,
      },
    );

    expect(exitCode).toBe(1);
    expect(seedSpy).not.toHaveBeenCalled();
  });
});
