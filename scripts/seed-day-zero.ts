#!/usr/bin/env bun

import { db } from "@/db/client";
import {
  applyDayZeroInstallation,
  applyDayZeroRepository,
  type DayZeroSeedCounts,
} from "@/lib/seed/day-zero";
import type { SeedDatabase } from "@/lib/seed/demo-data";

import { getLocalDatabaseSafetyError } from "./local-database-safety";

export type DayZeroStage = "installation" | "repository" | "reset";

export type RunDayZeroCliDependencies = {
  applyDayZeroInstallation: (database: SeedDatabase) => Promise<DayZeroSeedCounts>;
  applyDayZeroRepository: (database: SeedDatabase) => Promise<DayZeroSeedCounts>;
  database: SeedDatabase;
  resetDatabase: () => Promise<void>;
};

type TruncationClient = {
  <Row>(strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe: (query: string) => Promise<unknown>;
};

/**
 * Empties the browser-lane database. First-run state is derived from whether *any* installation or
 * repository row exists, so deleting the fixture's own ids cannot produce it: one row left behind
 * by an earlier run or by hand is enough to render the walk's first step as an activated portal.
 * This is the same reset the native concurrency lane performs on the same database
 * (`tests/helpers/native-postgres.ts`), and Drizzle's migration metadata lives outside `public`,
 * so migrations survive it.
 */
async function truncatePublicTables(client: TruncationClient): Promise<void> {
  const tables = await client<{ name: string }>`
    SELECT quote_ident(tablename) AS name
    FROM pg_tables
    WHERE schemaname = 'public'
  `;
  if (tables.length === 0) return;
  await client.unsafe(
    `TRUNCATE TABLE ${tables.map(({ name }) => name).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

const defaultDependencies: RunDayZeroCliDependencies = {
  applyDayZeroInstallation,
  applyDayZeroRepository,
  database: db,
  resetDatabase: () => truncatePublicTables(db.$client as unknown as TruncationClient),
};

const stages: readonly DayZeroStage[] = ["reset", "installation", "repository"];

function usage(): string {
  return `Usage: bun run scripts/seed-day-zero.ts <${stages.join(" | ")}>`;
}

function parseStage(args: string[]): DayZeroStage | null {
  if (args.length !== 1) return null;
  const [stage] = args;
  return stages.find((candidate) => candidate === stage) ?? null;
}

/**
 * Stages the day-zero activation fixture for the browser walk (#128). Refuses to run against
 * anything but the local browser-lane database before touching a database dependency, per
 * ADR 0007's fail-closed fixture policy. `reset` is destructive, so it runs under the same guard
 * the seeded lane uses, pinned to `loopworks_e2e`.
 */
export async function runDayZeroCli(
  args: string[],
  env: Partial<NodeJS.ProcessEnv> = process.env,
  dependencies: RunDayZeroCliDependencies = defaultDependencies,
): Promise<number> {
  const stage = parseStage(args);
  if (stage === null) {
    console.error(usage());
    return 1;
  }

  const safetyError = getLocalDatabaseSafetyError(env, {
    requiredDatabaseName: "loopworks_e2e",
    requireExplicitUrl: true,
  });
  if (safetyError) {
    console.error(safetyError);
    return 1;
  }

  if (stage === "reset") {
    await dependencies.resetDatabase();
    console.log("Day-zero stage reset: every public table is empty.");
    return 0;
  }

  const counts =
    stage === "installation"
      ? await dependencies.applyDayZeroInstallation(dependencies.database)
      : await dependencies.applyDayZeroRepository(dependencies.database);

  console.log(
    `Day-zero stage ${stage}: ${counts.githubInstallations} installation row(s), ${counts.repositories} repository row(s).`,
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runDayZeroCli(process.argv.slice(2));
  } finally {
    await db.$client.end();
  }
}
