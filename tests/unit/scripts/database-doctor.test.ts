import { readFileSync } from "node:fs";

import {
  type DatabaseDoctorDependencies,
  getMigrationStatus,
  runDatabaseDoctor,
} from "../../../scripts/database-doctor";

const canonicalUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

function createDependencies(options: {
  identity?: { username: string; database: string };
  tableExists?: boolean;
  applied?: string[];
  failure?: unknown;
}) {
  const queries: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  let closed = 0;
  const client = {
    unsafe: vi.fn(async (query: string) => {
      const normalized = query.replace(/\s+/g, " ").trim();
      queries.push(normalized);
      if (options.failure) throw options.failure;
      if (normalized.includes("current_user")) {
        return [options.identity ?? { username: "loopworks", database: "loopworks" }];
      }
      if (normalized.includes("to_regclass")) {
        return [{ migrationTable: options.tableExists === false ? null : "__drizzle_migrations" }];
      }
      if (normalized.includes("__drizzle_migrations")) {
        return (options.applied ?? ["one", "two"]).map((hash, index) => ({
          hash,
          createdAt: index + 1,
        }));
      }
      throw new Error(`Unexpected query: ${normalized}`);
    }),
    end: vi.fn(async () => {
      closed += 1;
    }),
  };
  const dependencies: DatabaseDoctorDependencies = {
    createClient: vi.fn(() => client),
    readMigrations: () => [
      { folderMillis: 1, hash: "one" },
      { folderMillis: 2, hash: "two" },
    ],
    log: (message) => logs.push(message),
    error: (message) => errors.push(message),
  };
  return {
    dependencies,
    queries,
    logs,
    errors,
    get closed() {
      return closed;
    },
  };
}

describe("database doctor", () => {
  it("is exposed through the package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["db:doctor"]).toBe("bun run scripts/database-doctor.ts");
  });

  it.each([
    ["default canonical target", {}, canonicalUrl],
    [
      "explicit loopback test target",
      { DATABASE_URL: "postgres://loopworks:loopworks@localhost:5432/loopworks_e2e" },
      "postgres://loopworks:loopworks@localhost:5432/loopworks_e2e",
    ],
  ] satisfies [string, Partial<NodeJS.ProcessEnv>, string][])(
    "reports URL, reachability, identity, and exact migrations for the %s",
    async (_label, env, expectedUrl) => {
      const harness = createDependencies({
        identity: {
          username: "loopworks",
          database: expectedUrl.endsWith("loopworks_e2e") ? "loopworks_e2e" : "loopworks",
        },
      });

      expect(await runDatabaseDoctor(env, harness.dependencies)).toBe(0);
      expect(harness.dependencies.createClient).toHaveBeenCalledWith(expectedUrl);
      expect(harness.logs.join(" ")).toMatch(/URL safety: pass/);
      expect(harness.logs.join(" ")).toMatch(/Reachability: pass/);
      expect(harness.logs.join(" ")).toMatch(/Identity: pass/);
      expect(harness.logs.join(" ")).toMatch(/Migrations: pass/);
      expect(harness.closed).toBe(1);
    },
  );

  it.each([
    ["malformed URL", { DATABASE_URL: "not a url" }],
    [
      "malformed encoded identity",
      { DATABASE_URL: "postgres://loopworks:secret@127.0.0.1/%E0%A4%A" },
    ],
    [
      "malformed encoded password",
      { DATABASE_URL: "postgres://loopworks:%ZZ@127.0.0.1/loopworks" },
    ],
    ["remote URL", { DATABASE_URL: "postgres://user:secret@db.internal/loopworks" }],
  ] satisfies [string, Partial<NodeJS.ProcessEnv>][])(
    "rejects a %s before client creation and redacts it",
    async (_label, env) => {
      const harness = createDependencies({});
      expect(await runDatabaseDoctor(env, harness.dependencies)).toBe(1);
      expect(harness.dependencies.createClient).not.toHaveBeenCalled();
      expect(harness.errors.join(" ")).not.toMatch(/secret|postgres:\/\//);
    },
  );

  it("fails on reachability errors and always closes the client", async () => {
    const harness = createDependencies({
      failure: { code: "ECONNREFUSED", message: "postgres://user:secret@127.0.0.1" },
    });
    expect(await runDatabaseDoctor({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toContain("Reachability: fail");
    expect(harness.errors.join(" ")).toContain("Postgres.app");
    expect(harness.errors.join(" ")).not.toContain("secret");
    expect(harness.closed).toBe(1);
  });

  it("fails when the connected role or database differs from the configured identity", async () => {
    const harness = createDependencies({
      identity: { username: "other", database: "other_database" },
    });
    expect(await runDatabaseDoctor({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toContain("Identity: fail");
    expect(harness.queries).toHaveLength(1);
    expect(harness.closed).toBe(1);
  });

  it.each([
    ["absent", false, [], "pending"],
    ["pending", true, ["one"], "pending"],
    ["divergent", true, ["unexpected"], "incompatible"],
    ["unexpected", true, ["one", "two", "extra"], "incompatible"],
  ] as const)("fails for %s migration state", async (_label, tableExists, applied, expected) => {
    const harness = createDependencies({ tableExists, applied: [...applied] });
    expect(await runDatabaseDoctor({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toContain(expected);
    expect(harness.closed).toBe(1);
  });

  it("derives exact migration status from ordered hash equality", () => {
    const expected = [
      { createdAt: 1, hash: "a" },
      { createdAt: 2, hash: "b" },
    ];
    expect(getMigrationStatus(expected, expected)).toBe("current");
    expect(getMigrationStatus(expected, [])).toBe("pending");
    expect(getMigrationStatus(expected, expected.slice(0, 1))).toBe("pending");
    expect(getMigrationStatus(expected, [{ createdAt: 1, hash: "b" }])).toBe("incompatible");
    expect(getMigrationStatus(expected, [...expected, { createdAt: 3, hash: "c" }])).toBe(
      "incompatible",
    );
    expect(
      getMigrationStatus(expected, [
        { createdAt: 10, hash: "a" },
        { createdAt: 2, hash: "b" },
      ]),
    ).toBe("incompatible");
  });

  it("rejects checked-in journal timestamp drift even when hashes still match", async () => {
    const harness = createDependencies({});
    harness.dependencies.readMigrations = () => [
      { folderMillis: 10, hash: "one" },
      { folderMillis: 20, hash: "two" },
    ];

    expect(await runDatabaseDoctor({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toContain("incompatible");
  });

  it("uses read-only diagnostic queries", async () => {
    const harness = createDependencies({});
    expect(await runDatabaseDoctor({}, harness.dependencies)).toBe(0);
    expect(harness.queries).toHaveLength(3);
    for (const query of harness.queries) expect(query).toMatch(/^SELECT\b/i);
    expect(harness.queries.join(" ")).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i,
    );
  });

  it("sanitizes a cleanup failure and resolves with exit 1", async () => {
    const harness = createDependencies({});
    const client = vi.mocked(harness.dependencies.createClient).mock.results[0]?.value;
    expect(client).toBeUndefined();
    vi.mocked(harness.dependencies.createClient).mockImplementationOnce(() => ({
      unsafe: vi.fn(async (query: string) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        if (normalized.includes("current_user")) {
          return [{ username: "loopworks", database: "loopworks" }];
        }
        if (normalized.includes("to_regclass")) {
          return [{ migrationTable: "__drizzle_migrations" }];
        }
        return [
          { hash: "one", createdAt: 1 },
          { hash: "two", createdAt: 2 },
        ];
      }),
      end: vi.fn(async () => {
        throw new Error("postgres://loopworks:cleanup-secret@127.0.0.1/loopworks");
      }),
    }));

    await expect(runDatabaseDoctor({}, harness.dependencies)).resolves.toBe(1);
    expect(harness.errors.join(" ")).not.toMatch(/cleanup-secret|postgres:\/\//);
  });
});
