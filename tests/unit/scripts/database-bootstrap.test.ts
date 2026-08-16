import { readFileSync } from "node:fs";

import {
  type BootstrapClient,
  type DatabaseBootstrapDependencies,
  runDatabaseBootstrap,
} from "../../../scripts/bootstrap-local-database";

const canonicalUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

type BootstrapState = {
  role?: {
    bypassRls?: boolean;
    canLogin: boolean;
    connectionLimit?: number;
    createDatabase?: boolean;
    createRole?: boolean;
    replication?: boolean;
    superuser?: boolean;
    validUntil?: string | null;
  };
  databases: Record<string, string | undefined>;
};

function createHarness(
  initial: BootstrapState,
  adminOutcomes: Record<
    string,
    | {
        privileges: { canSetRole?: boolean; createRole: boolean; createDatabase: boolean };
      }
    | { error: unknown }
  > = { cole: { privileges: { createRole: true, createDatabase: true } } },
) {
  const state: BootstrapState = {
    role: initial.role ? { ...initial.role } : undefined,
    databases: { ...initial.databases },
  };
  const events: string[] = [];
  const queries: string[] = [];
  const closed: string[] = [];
  const errors: string[] = [];
  const logs: string[] = [];

  const createClient: DatabaseBootstrapDependencies["createClient"] = ({ username }) => {
    events.push(`connect:${username}`);
    const outcome = adminOutcomes[username];
    const client: BootstrapClient = {
      unsafe: vi.fn(async (query: string, parameters: unknown[] = []) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        queries.push(normalized);
        if (normalized.includes("rolcreaterole") && normalized.includes("current_user")) {
          if (!outcome || "error" in outcome) throw outcome?.error ?? new Error("missing admin");
          events.push(`privileges:${username}`);
          return [
            {
              username,
              canSetRole: outcome.privileges.canSetRole ?? true,
              createRole: outcome.privileges.createRole,
              createDatabase: outcome.privileges.createDatabase,
            },
          ];
        }
        if (normalized.includes("FROM pg_roles") && parameters[0] === "loopworks") {
          events.push("inspect:role");
          return state.role
            ? [
                {
                  bypassRls: state.role.bypassRls ?? false,
                  canLogin: state.role.canLogin,
                  connectionLimit: state.role.connectionLimit ?? -1,
                  createDatabase: state.role.createDatabase ?? false,
                  createRole: state.role.createRole ?? false,
                  replication: state.role.replication ?? false,
                  superuser: state.role.superuser ?? false,
                  validUntil: state.role.validUntil ?? null,
                },
              ]
            : [];
        }
        if (normalized.startsWith('CREATE ROLE "loopworks"')) {
          events.push("create:role");
          state.role = { canLogin: true };
          return [];
        }
        if (normalized.includes("FROM pg_database")) {
          const database = String(parameters[0]);
          events.push(`inspect:database:${database}`);
          const owner = state.databases[database];
          return owner ? [{ owner }] : [];
        }
        const createDatabase = normalized.match(
          /^CREATE DATABASE "(loopworks(?:_e2e)?)" OWNER "loopworks"$/,
        );
        if (createDatabase?.[1]) {
          events.push(`create:database:${createDatabase[1]}`);
          state.databases[createDatabase[1]] = "loopworks";
          return [];
        }
        throw new Error(`Unexpected query shape: ${normalized}`);
      }),
      end: vi.fn(async () => {
        events.push(`close:${username}`);
        closed.push(username);
      }),
    };
    return client;
  };

  return {
    state,
    events,
    queries,
    closed,
    errors,
    logs,
    dependencies: {
      createClient,
      getMacOsUsername: () => "cole",
      error: (message: string) => errors.push(message),
      log: (message: string) => logs.push(message),
      verifyTarget: async (databaseName) => {
        events.push(`verify:database:${databaseName}`);
      },
    } satisfies DatabaseBootstrapDependencies,
  };
}

describe("local Postgres bootstrap", () => {
  it("is exposed through the package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["db:bootstrap"]).toBe(
      "bun run scripts/bootstrap-local-database.ts",
    );
  });

  it("creates the fixed role and databases in dependency order from a fresh cluster", async () => {
    const harness = createHarness({ databases: {} });

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(0);
    expect(harness.events).toEqual([
      "connect:cole",
      "privileges:cole",
      "inspect:role",
      "inspect:database:loopworks",
      "inspect:database:loopworks_e2e",
      "create:role",
      "create:database:loopworks",
      "create:database:loopworks_e2e",
      "close:cole",
      "verify:database:loopworks",
      "verify:database:loopworks_e2e",
    ]);
    expect(harness.state).toEqual({
      role: { canLogin: true },
      databases: { loopworks: "loopworks", loopworks_e2e: "loopworks" },
    });
  });

  it("fills partial state and treats a complete cluster as an idempotent success", async () => {
    const harness = createHarness({
      role: { canLogin: true },
      databases: { loopworks: "loopworks" },
    });
    expect(await runDatabaseBootstrap({ DATABASE_URL: canonicalUrl }, harness.dependencies)).toBe(
      0,
    );
    expect(harness.events).not.toContain("create:role");
    expect(harness.events).toContain("create:database:loopworks_e2e");

    harness.events.length = 0;
    expect(await runDatabaseBootstrap({ DATABASE_URL: canonicalUrl }, harness.dependencies)).toBe(
      0,
    );
    expect(harness.events.filter((event) => event.startsWith("create:"))).toEqual([]);
  });

  it("discovers the macOS role first and then postgres, requiring both creation privileges", async () => {
    const harness = createHarness(
      {
        role: { canLogin: true },
        databases: { loopworks: "loopworks" },
      },
      {
        cole: { privileges: { createRole: false, createDatabase: true } },
        postgres: { privileges: { createRole: true, createDatabase: true } },
      },
    );

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(0);
    expect(harness.events.slice(0, 6)).toEqual([
      "connect:cole",
      "privileges:cole",
      "close:cole",
      "connect:postgres",
      "privileges:postgres",
      "inspect:role",
    ]);
    expect(harness.closed).toEqual(["cole", "postgres"]);
  });

  it("requires the administrator to be able to set the existing loopworks role", async () => {
    const harness = createHarness(
      {
        role: { canLogin: true },
        databases: { loopworks: "loopworks" },
      },
      {
        cole: {
          privileges: { canSetRole: false, createRole: true, createDatabase: true },
        },
        postgres: {
          privileges: { canSetRole: true, createRole: true, createDatabase: true },
        },
      },
    );

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(0);
    expect(harness.events.slice(0, 6)).toEqual([
      "connect:cole",
      "privileges:cole",
      "close:cole",
      "connect:postgres",
      "privileges:postgres",
      "inspect:role",
    ]);
  });

  it("uses a PostgreSQL 15-compatible membership check for partial-state ownership", async () => {
    const harness = createHarness({
      role: { canLogin: true },
      databases: { loopworks: "loopworks" },
    });

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(0);
    const capabilityQuery = harness.queries.find((query) => query.includes("current_user"));
    expect(capabilityQuery).toContain("server_version_num");
    expect(capabilityQuery).toContain("rolsuper");
    expect(capabilityQuery).toContain("'MEMBER'");
    expect(capabilityQuery).toContain("'SET'");
  });

  it("reports the last candidate's connection failure after an earlier privilege failure", async () => {
    const harness = createHarness(
      { databases: {} },
      {
        cole: { privileges: { createRole: false, createDatabase: true } },
        postgres: { error: { code: "ECONNREFUSED", message: "connection-secret" } },
      },
    );

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toContain("Postgres.app");
    expect(harness.errors.join(" ")).not.toMatch(/connection-secret|CREATEROLE/);
  });

  it("reports the required admin privileges when every connected candidate lacks them", async () => {
    const harness = createHarness(
      { databases: {} },
      {
        cole: { privileges: { createRole: false, createDatabase: true } },
        postgres: { privileges: { createRole: true, createDatabase: false } },
      },
    );

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
    expect(harness.errors.join(" ")).toMatch(/CREATEROLE.*CREATEDB.*SET ROLE/);
  });

  it.each([
    ["production runtime", { NODE_ENV: "production" }],
    ["empty explicit target", { DATABASE_URL: "" }],
    ["remote target", { DATABASE_URL: "postgres://loopworks:secret@db.internal:5432/loopworks" }],
    [
      "non-canonical loopback target",
      { DATABASE_URL: "postgres://loopworks:secret@localhost:5432/loopworks" },
    ],
  ] satisfies [string, Partial<NodeJS.ProcessEnv>][])(
    "refuses %s before connecting or mutating",
    async (_label, env) => {
      const harness = createHarness({ databases: {} });
      expect(await runDatabaseBootstrap(env, harness.dependencies)).toBe(1);
      expect(harness.events).toEqual([]);
      expect(harness.errors.join(" ")).not.toContain("secret");
      expect(harness.errors.join(" ")).not.toContain("postgres://");
    },
  );

  it("refuses a non-login role and database ownership conflicts without altering them", async () => {
    const roleConflict = createHarness({ role: { canLogin: false }, databases: {} });
    expect(await runDatabaseBootstrap({}, roleConflict.dependencies)).toBe(1);
    expect(roleConflict.events).not.toContain("create:role");
    expect(roleConflict.events.filter((event) => event.startsWith("create:"))).toEqual([]);

    const ownerConflict = createHarness({
      role: { canLogin: true },
      databases: { loopworks: "other_owner" },
    });
    expect(await runDatabaseBootstrap({}, ownerConflict.dependencies)).toBe(1);
    expect(ownerConflict.state.databases.loopworks).toBe("other_owner");
    expect(ownerConflict.events).not.toContain("create:database:loopworks");
  });

  it.each([
    ["superuser", { canLogin: true, superuser: true }],
    ["create-role", { canLogin: true, createRole: true }],
    ["replication", { canLogin: true, replication: true }],
    ["row-security bypass", { canLogin: true, bypassRls: true }],
    ["expired", { canLogin: true, validUntil: "2000-01-01T00:00:00.000Z" }],
    ["zero connection limit", { canLogin: true, connectionLimit: 0 }],
  ] as const)(
    "refuses an existing %s application role without alteration",
    async (_label, role) => {
      const harness = createHarness({ role, databases: {} });
      expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
      expect(harness.events.filter((event) => event.startsWith("create:"))).toEqual([]);
    },
  );

  it("accepts the legacy local CREATEDB attribute but does not grant it to new roles", async () => {
    const harness = createHarness({
      role: { canLogin: true, createDatabase: true },
      databases: { loopworks: "loopworks", loopworks_e2e: "loopworks" },
    });

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(0);
    expect(harness.events.filter((event) => event.startsWith("create:"))).toEqual([]);
  });

  it("closes every attempted client and redacts secret-bearing discovery failures", async () => {
    const harness = createHarness(
      { databases: {} },
      {
        cole: { error: new Error("postgres://cole:first-secret@127.0.0.1/postgres") },
        postgres: { error: { code: "28P01", message: "password second-secret rejected" } },
      },
    );

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
    expect(harness.closed).toEqual(["cole", "postgres"]);
    expect(harness.errors.join(" ")).not.toMatch(/first-secret|second-secret|postgres:\/\//);
  });

  it("closes the selected admin and redacts a secret-bearing mutation failure", async () => {
    const harness = createHarness({ databases: {} });
    const createClient = harness.dependencies.createClient;
    harness.dependencies.createClient = (config) => {
      const client = createClient(config);
      const unsafe = client.unsafe;
      client.unsafe = async (query, parameters) => {
        if (query.includes("CREATE ROLE")) {
          throw new Error("postgres://admin:mutation-secret@127.0.0.1/postgres");
        }
        return unsafe(query, parameters);
      };
      return client;
    };

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
    expect(harness.closed).toEqual(["cole"]);
    expect(harness.errors.join(" ")).not.toMatch(/mutation-secret|postgres:\/\//);
  });

  it("sanitizes a selected-admin cleanup failure and resolves with exit 1", async () => {
    const harness = createHarness({
      role: { canLogin: true },
      databases: { loopworks: "loopworks", loopworks_e2e: "loopworks" },
    });
    const createClient = harness.dependencies.createClient;
    harness.dependencies.createClient = (config) => {
      const client = createClient(config);
      client.end = async () => {
        throw new Error("postgres://admin:cleanup-secret@127.0.0.1/postgres");
      };
      return client;
    };

    await expect(runDatabaseBootstrap({}, harness.dependencies)).resolves.toBe(1);
    expect(harness.errors.join(" ")).not.toMatch(/cleanup-secret|postgres:\/\//);
  });

  it("verifies canonical credentials after setup and sanitizes authentication failures", async () => {
    const harness = createHarness({
      role: { canLogin: true },
      databases: { loopworks: "loopworks", loopworks_e2e: "loopworks" },
    });
    harness.dependencies.verifyTarget = async (databaseName) => {
      harness.events.push(`verify:database:${databaseName}`);
      if (databaseName === "loopworks_e2e") {
        throw { code: "28P01", message: "password verification-secret rejected" };
      }
    };

    expect(await runDatabaseBootstrap({}, harness.dependencies)).toBe(1);
    expect(harness.events).toContain("verify:database:loopworks");
    expect(harness.errors.join(" ")).toContain("authentication");
    expect(harness.errors.join(" ")).not.toContain("verification-secret");
  });
});
