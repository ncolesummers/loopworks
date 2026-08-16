#!/usr/bin/env bun

import { userInfo } from "node:os";

import postgres from "postgres";

import { localDatabaseUrl } from "@/lib/config/registry";
import { classifyDatabaseError, databaseFailureMessage } from "./database-errors";
import { resolveLocalDatabaseTarget } from "./local-database-safety";

const ROLE_NAME = "loopworks";
const DATABASE_NAMES = ["loopworks", "loopworks_e2e"] as const;
type FixedDatabaseName = (typeof DATABASE_NAMES)[number];

export type BootstrapClient = {
  unsafe: (query: string, parameters?: unknown[]) => Promise<unknown[]>;
  end: (options?: { timeout?: number }) => Promise<void>;
};

export type DatabaseBootstrapDependencies = {
  createClient: (config: { database: string; username: string }) => BootstrapClient;
  error: (message: string) => void;
  getMacOsUsername: () => string;
  log: (message: string) => void;
  verifyTarget: (databaseName: FixedDatabaseName) => Promise<void>;
};

const defaultDependencies: DatabaseBootstrapDependencies = {
  createClient: ({ database, username }) =>
    postgres({
      database,
      host: "127.0.0.1",
      max: 1,
      onnotice: () => {},
      port: 5432,
      prepare: false,
      username,
    }) as unknown as BootstrapClient,
  error: console.error,
  getMacOsUsername: () => userInfo().username,
  log: console.log,
  verifyTarget: async (databaseName) => {
    const targetUrl = new URL(localDatabaseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const client = postgres(targetUrl.toString(), {
      max: 1,
      onnotice: () => {},
      prepare: false,
    }) as unknown as BootstrapClient;
    try {
      const [identity] = (await client.unsafe(
        "SELECT current_user AS username, current_database() AS database",
      )) as { database: string; username: string }[];
      if (identity?.username !== ROLE_NAME || identity.database !== databaseName) {
        throw new Error("Canonical database identity mismatch.");
      }
    } finally {
      await client.end({ timeout: 5 });
    }
  },
};

type Admin = { client: BootstrapClient; username: string };

type AdminDiscovery = {
  admin: Admin | null;
  cleanupError?: unknown;
  lastFailure?: "error" | "privilege";
  lastError?: unknown;
};

async function discoverAdmin(dependencies: DatabaseBootstrapDependencies): Promise<AdminDiscovery> {
  let lastError: unknown;
  let lastFailure: AdminDiscovery["lastFailure"];
  const candidates = [...new Set([dependencies.getMacOsUsername(), "postgres"])];
  for (const username of candidates) {
    let client: BootstrapClient;
    try {
      client = dependencies.createClient({ database: "postgres", username });
    } catch (error) {
      lastError = error;
      lastFailure = "error";
      continue;
    }
    try {
      const [capabilities] = (await client.unsafe(`
        SELECT current_user AS username,
               rolcreaterole AS "createRole",
               rolcreatedb AS "createDatabase",
               CASE
                 WHEN to_regrole('loopworks') IS NULL THEN
                   current_setting('server_version_num')::int >= 160000 OR rolsuper
                 WHEN (
                     EXISTS (SELECT 1 FROM pg_database WHERE datname = 'loopworks')
                     AND EXISTS (SELECT 1 FROM pg_database WHERE datname = 'loopworks_e2e')
                   ) THEN TRUE
                 WHEN current_setting('server_version_num')::int >= 160000
                   THEN pg_has_role(current_user, 'loopworks', 'SET')
                 ELSE pg_has_role(current_user, 'loopworks', 'MEMBER')
               END AS "canSetRole"
        FROM pg_roles
        WHERE rolname = current_user
      `)) as {
        canSetRole: boolean;
        createDatabase: boolean;
        createRole: boolean;
        username: string;
      }[];
      if (capabilities?.createRole && capabilities.createDatabase && capabilities.canSetRole) {
        return { admin: { client, username }, lastError, lastFailure };
      }
      lastFailure = "privilege";
    } catch (error) {
      lastError = error;
      lastFailure = "error";
    }
    try {
      await client.end({ timeout: 5 });
    } catch (cleanupError) {
      return { admin: null, cleanupError, lastError, lastFailure };
    }
  }
  return { admin: null, lastError, lastFailure };
}

type ExistingRole = {
  bypassRls: boolean;
  canLogin: boolean;
  connectionLimit: number;
  createDatabase: boolean;
  createRole: boolean;
  replication: boolean;
  superuser: boolean;
  validUntil: Date | string | null;
};

function isCompatibleRole(role: ExistingRole): boolean {
  // The pre-bootstrap development guide had developers grant CREATEDB so the
  // loopworks login could create loopworks_e2e itself. Preserve that legacy
  // local attribute, but never grant it to roles this bootstrap creates.
  return (
    role.canLogin &&
    role.connectionLimit === -1 &&
    !role.superuser &&
    !role.createRole &&
    !role.replication &&
    !role.bypassRls &&
    role.validUntil === null
  );
}

async function prepareLocalObjects(
  client: BootstrapClient,
  dependencies: DatabaseBootstrapDependencies,
): Promise<number> {
  try {
    const roleRows = (await client.unsafe(
      `SELECT rolcanlogin AS "canLogin",
              rolconnlimit AS "connectionLimit",
              rolsuper AS superuser,
              rolcreatedb AS "createDatabase",
              rolcreaterole AS "createRole",
              rolreplication AS replication,
              rolbypassrls AS "bypassRls",
              rolvaliduntil AS "validUntil"
       FROM pg_roles
       WHERE rolname = $1`,
      [ROLE_NAME],
    )) as ExistingRole[];
    const databaseOwners = new Map<string, string | undefined>();
    for (const databaseName of DATABASE_NAMES) {
      const rows = (await client.unsafe(
        `SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = $1`,
        [databaseName],
      )) as { owner: string }[];
      databaseOwners.set(databaseName, rows[0]?.owner);
    }

    if (roleRows[0] && !isCompatibleRole(roleRows[0])) {
      dependencies.error(
        "Database bootstrap refused: the existing loopworks role has incompatible login or privilege attributes.",
      );
      return 1;
    }
    for (const [databaseName, owner] of databaseOwners) {
      if (owner && owner !== ROLE_NAME) {
        dependencies.error(
          `Database bootstrap refused: the existing ${databaseName} database has a different owner.`,
        );
        return 1;
      }
    }

    if (!roleRows[0]) {
      await client.unsafe(`CREATE ROLE "loopworks" LOGIN PASSWORD 'loopworks'`);
    }
    for (const databaseName of DATABASE_NAMES) {
      if (!databaseOwners.get(databaseName)) {
        await client.unsafe(`CREATE DATABASE "${databaseName}" OWNER "loopworks"`);
      }
    }

    dependencies.log("Local Postgres bootstrap is complete. Run 'bun run db:doctor'.");
    return 0;
  } catch (error) {
    dependencies.error(databaseFailureMessage(classifyDatabaseError(error), "bootstrap"));
    return 1;
  }
}

export async function runDatabaseBootstrap(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  dependencies: DatabaseBootstrapDependencies = defaultDependencies,
): Promise<number> {
  const target = resolveLocalDatabaseTarget(env, {
    defaultUrl: localDatabaseUrl,
    exactUrl: localDatabaseUrl,
  });
  if (target.error) {
    dependencies.error(target.error);
    return 1;
  }

  const discovery = await discoverAdmin(dependencies);
  if (!discovery.admin) {
    if (discovery.cleanupError) {
      dependencies.error(
        `Database bootstrap cleanup failed. ${databaseFailureMessage(
          classifyDatabaseError(discovery.cleanupError),
          "bootstrap",
        )}`,
      );
      return 1;
    }
    if (discovery.lastFailure === "privilege") {
      dependencies.error(
        "Database bootstrap failed: neither administrator candidate has CREATEROLE, CREATEDB, and SET ROLE capability for loopworks.",
      );
      return 1;
    }
    dependencies.error(
      databaseFailureMessage(classifyDatabaseError(discovery.lastError), "bootstrap"),
    );
    return 1;
  }

  const { client } = discovery.admin;
  const exitCode = await prepareLocalObjects(client, dependencies);
  try {
    await client.end({ timeout: 5 });
  } catch (cleanupError) {
    dependencies.error(
      `Database bootstrap cleanup failed. ${databaseFailureMessage(
        classifyDatabaseError(cleanupError),
        "bootstrap",
      )}`,
    );
    return 1;
  }
  if (exitCode !== 0) return exitCode;
  try {
    for (const databaseName of DATABASE_NAMES) await dependencies.verifyTarget(databaseName);
  } catch (error) {
    dependencies.error(databaseFailureMessage(classifyDatabaseError(error), "bootstrap"));
    return 1;
  }
  return exitCode;
}

if (import.meta.main) process.exitCode = await runDatabaseBootstrap();
