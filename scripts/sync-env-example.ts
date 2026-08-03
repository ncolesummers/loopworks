import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { configRegistry } from "@/lib/config/registry";

export type EnvExampleCheckResult =
  | { ok: true; reason: "current" }
  | { ok: false; reason: "missing" | "stale" };

function quoteEnvValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

export function renderEnvExample(): string {
  const lines = [
    "# Generated from src/lib/config/registry.ts.",
    "# Run `bun run config:sync` after changing configuration declarations.",
  ];
  let previousGroup: string | undefined;

  for (const definition of configRegistry) {
    if (definition.readOnly) continue;

    if (previousGroup !== undefined && previousGroup !== definition.group) lines.push("");
    lines.push(`# ${definition.description}`);
    lines.push(`${definition.name}=${quoteEnvValue(definition.exampleValue ?? "")}`);
    previousGroup = definition.group;
  }

  return `${lines.join("\n")}\n`;
}

export async function checkEnvExample(root: string): Promise<EnvExampleCheckResult> {
  let current: string;
  try {
    current = await readFile(path.join(root, ".env.example"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, reason: "missing" };
    throw error;
  }

  return current === renderEnvExample()
    ? { ok: true, reason: "current" }
    : { ok: false, reason: "stale" };
}

export async function syncEnvExample(root: string): Promise<{ ok: true; changed: boolean }> {
  const check = await checkEnvExample(root);
  if (check.ok) return { ok: true, changed: false };

  await writeFile(path.join(root, ".env.example"), renderEnvExample());
  return { ok: true, changed: true };
}

async function main(args: string[]): Promise<void> {
  const mode = args[0];
  if (mode !== "--check" && mode !== "--write") {
    throw new Error("Usage: bun run scripts/sync-env-example.ts (--check | --write)");
  }

  const root = process.cwd();
  if (mode === "--write") {
    await syncEnvExample(root);
    return;
  }

  const result = await checkEnvExample(root);
  if (!result.ok) {
    throw new Error(
      `.env.example is ${result.reason}; run \`bun run config:sync\` and commit the result.`,
    );
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
