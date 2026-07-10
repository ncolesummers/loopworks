#!/usr/bin/env bun

import { getLocalDatabaseSafetyError } from "./local-database-safety";

type SeededPostgresCommand = readonly string[];

export type SeededPostgresE2eDependencies = {
  env?: Partial<NodeJS.ProcessEnv>;
  error?: (message: string) => void;
  runCommand?: (
    command: SeededPostgresCommand,
    env: Partial<NodeJS.ProcessEnv>,
  ) => Promise<number> | number;
};

async function runCommand(
  command: SeededPostgresCommand,
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
    command: ["bun", "run", "db:migrate"],
    failure:
      "Seeded Postgres migration stage failed. Confirm local Postgres is running and the loopworks role and loopworks_e2e database exist.",
  },
  {
    command: ["bun", "run", "db:seed:reset"],
    failure:
      "Seeded Postgres seed stage failed. Confirm migrations completed and the local role can write to loopworks_e2e.",
  },
  {
    command: ["bunx", "playwright", "test", "--config=playwright.seeded.config.ts"],
    failure: "Seeded Postgres Playwright stage failed. Review the browser assertions above.",
  },
] as const;

export async function runSeededPostgresE2e(
  dependencies: SeededPostgresE2eDependencies = {},
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
  process.exitCode = await runSeededPostgresE2e();
}
