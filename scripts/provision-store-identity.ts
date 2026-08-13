#!/usr/bin/env bun

import { db } from "@/db/client";
import { readSuppliedRawConfig } from "@/lib/config/registry";
import {
  isUndefinedTableError,
  provisionStoreIdentity,
  readStoreIdentity,
  type StoreIdentityProvisionDatabase,
} from "@/lib/portal/store-identity";

export type ProvisionStoreIdentityCliDependencies = {
  database: StoreIdentityProvisionDatabase;
};

export type ProvisionStoreIdentityCliResult = {
  exitCode: number;
  lines: string[];
};

const defaultDependencies: ProvisionStoreIdentityCliDependencies = {
  database: db,
};

/** Host and database name only — the connection URL carries credentials. */
export function describeDatabaseTarget(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const rawUrl = readSuppliedRawConfig("DATABASE_URL", env);
  if (!rawUrl || !URL.canParse(rawUrl)) {
    return "unknown";
  }

  const url = new URL(rawUrl);
  return `${url.hostname}/${url.pathname.replace(/^\//, "") || "unknown"}`;
}

function usage(): ProvisionStoreIdentityCliResult {
  return {
    exitCode: 1,
    lines: ["Usage: bun run db:provision [--check]"],
  };
}

/**
 * `--check` is the first thing an operator runs, and on a store that predates the
 * identity migration the table is not there yet. That is the same answer as an
 * empty table — this store has no identity — and reporting it as one keeps the
 * documented pre-migration step usable instead of failing on a raw driver error.
 */
async function readStoreIdentityIfPresent(
  database: StoreIdentityProvisionDatabase,
): Promise<string | undefined> {
  try {
    return await readStoreIdentity(database);
  } catch (error) {
    if (isUndefinedTableError(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Reports or issues the identity of the store `DATABASE_URL` points at (#158).
 *
 * Recovery path for a store that has none: the migration issues an identity to
 * every database it creates, but a truncate of `public` removes it, and a
 * production read against a store it cannot identify fails closed. This never
 * overwrites an existing identity — reissuing one would let a wiped database
 * silently re-earn the trust the wipe should have cost it, which is the failure
 * being fixed rather than a recovery from it.
 */
export async function runProvisionStoreIdentityCli(
  argv: readonly string[] = [],
  dependencies: ProvisionStoreIdentityCliDependencies = defaultDependencies,
): Promise<ProvisionStoreIdentityCliResult> {
  const unknownArguments = argv.filter((argument) => argument !== "--check");
  if (unknownArguments.length > 0) {
    return usage();
  }

  if (argv.includes("--check")) {
    const storeId = await readStoreIdentityIfPresent(dependencies.database);

    return storeId === undefined
      ? {
          exitCode: 1,
          lines: [
            "No store identity is recorded. Production reads fail closed until one is.",
            "Run `bun run db:provision` against this database to issue one.",
          ],
        }
      : { exitCode: 0, lines: [`Store identity ${storeId}`] };
  }

  const result = await provisionStoreIdentity({ database: dependencies.database });

  return {
    exitCode: 0,
    lines: result.provisioned
      ? [
          `Provisioned store identity ${result.storeId}`,
          "Set LOOPWORKS_EXPECTED_STORE_ID to this value for the deployment that reads it.",
        ]
      : [
          `Store identity ${result.storeId} already recorded; left unchanged.`,
          "Set LOOPWORKS_EXPECTED_STORE_ID to this value for the deployment that reads it.",
        ],
  };
}

if (import.meta.main) {
  try {
    // Naming the database is what stops the documented flow from going wrong
    // silently: Bun auto-loads `.env.local`, so an operator meaning to read
    // production's identity can easily read their local store's instead and set
    // that as the expected value. The URL itself is never printed; it carries
    // credentials.
    console.log(`Database ${describeDatabaseTarget()}`);
    const { exitCode, lines } = await runProvisionStoreIdentityCli(Bun.argv.slice(2));
    for (const line of lines) {
      console.log(line);
    }
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Store identity provisioning failed.");
    process.exitCode = 1;
  } finally {
    // Without this the process never exits, and the command the runbook tells an
    // operator to run to read the value simply hangs.
    await db.$client.end();
  }
}
