#!/usr/bin/env bun

import { isIP } from "node:net";

import { db } from "@/db/client";
import { isProductionRuntime } from "@/lib/runtime";
import {
  buildDemoSeedData,
  type SeedCounts,
  type SeedDatabase,
  seedDemoData,
} from "@/lib/seed/demo-data";

const defaultLocalDatabaseUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

/**
 * Mirrors `isLoopbackWebhookUrl` in `scripts/github-webhook-fixture.ts`. The
 * production-runtime check alone is not enough: an operator's shell can have
 * `DATABASE_URL` pointed at a real (non-production-labeled) Postgres host
 * while `NODE_ENV`/`VERCEL_ENV` are unset. Seeding must refuse that too.
 */
function isLoopbackDatabaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return (
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]" ||
    (isIP(parsed.hostname) === 4 && parsed.hostname.split(".")[0] === "127")
  );
}

export type RunSeedCliDependencies = {
  database: SeedDatabase;
  seedDemoData: (database: SeedDatabase, options?: { reset?: boolean }) => Promise<SeedCounts>;
};

const defaultDependencies: RunSeedCliDependencies = {
  database: db,
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

  if (isProductionRuntime(env)) {
    console.error(
      "Refusing to seed demo data: this looks like a production environment " +
        "(NODE_ENV or VERCEL_ENV is 'production'). Loopworks demo seed data must " +
        "never run against production, per ADR 0007.",
    );
    return 1;
  }

  if (!isLoopbackDatabaseUrl(env.DATABASE_URL ?? defaultLocalDatabaseUrl)) {
    console.error(
      "Refusing to seed demo data: DATABASE_URL does not point at a loopback " +
        "host (localhost/127.0.0.1/::1). Loopworks demo seed data must only run " +
        "against a local Postgres instance, per ADR 0007 - a production-labeled " +
        "runtime is not the only way this could write into a real database.",
    );
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

  const counts = await dependencies.seedDemoData(dependencies.database, {
    reset: parsed.reset,
  });
  printCounts(`Seeded demo data${parsed.reset ? " (reset first)" : ""}:`, counts);

  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runSeedCli(process.argv.slice(2));
  } finally {
    // `db` is a lazy postgres-js pool: it only opens a socket once a query
    // runs (inside seedDemoData's transaction), but once open, postgres-js
    // keeps it alive to keep the event loop from exiting on its own.
    // Closing it here (a no-op if no query ever ran) lets the CLI actually
    // return control to the shell instead of hanging after printing counts.
    await db.$client.end({ timeout: 5 });
  }
}
