#!/usr/bin/env bun

import {
  buildDemoSeedData,
  type SeedCounts,
  type SeedDatabase,
  seedDemoData,
} from "@/lib/seed/demo-data";
import { classifyDatabaseError, databaseFailureMessage } from "./database-errors";
import { getLocalDatabaseSafetyError } from "./local-database-safety";

export type RunSeedCliDependencies = {
  closeDatabase?: (database: SeedDatabase) => Promise<void>;
  database?: SeedDatabase;
  loadDatabase?: () => Promise<SeedDatabase>;
  seedDemoData: (database: SeedDatabase, options?: { reset?: boolean }) => Promise<SeedCounts>;
};

const defaultDependencies: RunSeedCliDependencies = {
  closeDatabase: async (database) => {
    const client = (
      database as SeedDatabase & {
        $client: { end: (options?: { timeout?: number }) => Promise<void> };
      }
    ).$client;
    await client.end({ timeout: 5 });
  },
  loadDatabase: async () => (await import("@/db/client")).db,
  seedDemoData,
};

type ParsedSeedArgs = {
  dryRun: boolean;
  reset: boolean;
};

function usage(): string {
  return "Usage: bun run scripts/seed-demo-data.ts [--reset] [--dry-run]";
}

function parseSeedArgs(args: string[]): ParsedSeedArgs {
  let dryRun = false;
  let reset = false;

  for (const arg of args) {
    if (arg === "--reset") {
      reset = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, reset };
}

function printCounts(label: string, counts: Record<string, number>) {
  console.log(label);
  for (const [table, count] of Object.entries(counts)) {
    console.log(`- ${table}: ${count}`);
  }
}

/**
 * CLI entrypoint for seeding (or resetting and reseeding) the Loopworks demo
 * dataset. Refuses to run against a production environment before touching
 * any database dependency, per ADR 0007's fail-closed fixture policy.
 */
export async function runSeedCli(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = process.env,
  dependencies: RunSeedCliDependencies = defaultDependencies,
): Promise<number> {
  let parsed: ParsedSeedArgs;
  try {
    parsed = parseSeedArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 1;
  }

  const safetyError = getLocalDatabaseSafetyError(env, { requireExplicitUrl: true });
  if (safetyError) {
    console.error(safetyError);
    return 1;
  }

  if (parsed.dryRun) {
    const built = buildDemoSeedData();
    printCounts(`Dry run for demo seed data${parsed.reset ? " (with reset)" : ""}:`, {
      repositories: built.repositories.length,
      vercelProjects: built.vercelProjects.length,
      loops: built.loops.length,
      loopRuns: built.loopRuns.length,
      runSteps: built.runSteps.length,
      artifacts: built.artifacts.length,
      approvals: built.approvals.length,
      approvalTransitionEvents: built.approvalTransitionEvents.length,
      deployments: built.deployments.length,
    });
    return 0;
  }

  let database: SeedDatabase | undefined;
  let exitCode = 1;
  try {
    database = dependencies.database ?? (await dependencies.loadDatabase?.());
    if (!database) throw new Error("Database dependency is unavailable.");
    const counts = await dependencies.seedDemoData(database, {
      reset: parsed.reset,
    });
    printCounts(`Seeded demo data${parsed.reset ? " (reset first)" : ""}:`, counts);
    exitCode = 0;
  } catch (error) {
    console.error(databaseFailureMessage(classifyDatabaseError(error), "seed"));
  }

  if (database && dependencies.closeDatabase) {
    try {
      await dependencies.closeDatabase(database);
    } catch (error) {
      console.error(databaseFailureMessage(classifyDatabaseError(error), "seed"));
      return 1;
    }
  }
  return exitCode;
}

if (import.meta.main) process.exitCode = await runSeedCli(process.argv.slice(2));
