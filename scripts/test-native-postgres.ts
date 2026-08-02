#!/usr/bin/env bun

import { getLocalDatabaseSafetyError } from "./local-database-safety";

type NativePostgresCommand = readonly string[];

export type NativePostgresTestDependencies = {
  env?: Partial<NodeJS.ProcessEnv>;
  error?: (message: string) => void;
  runCommand?: (
    command: NativePostgresCommand,
    env: Partial<NodeJS.ProcessEnv>,
  ) => Promise<number> | number;
};

async function runCommand(
  command: NativePostgresCommand,
  env: Partial<NodeJS.ProcessEnv>,
): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return await child.exited;
}

const stages = [
  {
    command: ["bunx", "vitest", "run", "--config=vitest.postgres.config.ts"],
    failure:
      "Native Postgres admission lane failed. Confirm local Postgres is running and the loopworks role and loopworks_e2e database exist, then review the assertions above.",
  },
] as const;

/**
 * Runs the native PostgreSQL admission lane. The lane fails closed: an unsafe or
 * missing DATABASE_URL is an error, never a skip, because a skipped concurrency
 * lane silently asserts nothing about production lock behavior.
 */
export async function runNativePostgresTests(
  dependencies: NativePostgresTestDependencies = {},
): Promise<number> {
  const env = dependencies.env ?? process.env;
  const reportError = dependencies.error ?? console.error;
  const execute = dependencies.runCommand ?? runCommand;
  const safetyError = getLocalDatabaseSafetyError(env, {
    requiredDatabaseName: "loopworks_e2e",
    requireExplicitUrl: true,
  });

  if (safetyError) {
    reportError(safetyError);
    return 1;
  }

  for (const stage of stages) {
    const exitCode = await execute(stage.command, env);
    if (exitCode !== 0) {
      reportError(stage.failure);
      return 1;
    }
  }

  return 0;
}

if (import.meta.main) {
  process.exitCode = await runNativePostgresTests();
}
