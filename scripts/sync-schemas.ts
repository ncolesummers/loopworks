import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  personaJourneyRegistryId,
  personaJourneyRegistrySchema,
  personaJourneyRegistryVersion,
} from "../schemas/persona-journey";

export type SchemaMirror = {
  /** Zod module the mirror is generated from; recorded in the file's marker. */
  source: string;
  /** Repository-relative path of the generated JSON schema. */
  target: string;
  /** Versioned contract identifier, so a v2 cannot collide on the same `$id`. */
  id: string;
  title: string;
  syncScript: string;
  schema: z.ZodType;
};

/**
 * Generated JSON schema mirrors.
 *
 * `schemas/loop-manifest.schema.json` is deliberately absent: it is a
 * hand-maintained mirror whose conversion to codegen is #106. Adding it here
 * would rewrite a file several tests assert against, well outside #241.
 */
export const schemaMirrors: SchemaMirror[] = [
  {
    source: "schemas/persona-journey.ts",
    target: `schemas/persona-journey.v${personaJourneyRegistryVersion}.schema.json`,
    id: `https://loopworks.local/schemas/persona-journey.v${personaJourneyRegistryVersion}.schema.json`,
    title: `Persona Journey Registry (${personaJourneyRegistryId})`,
    syncScript: "bun run schemas:sync",
    schema: personaJourneyRegistrySchema,
  },
];

export function renderSchemaMirror(mirror: SchemaMirror): string {
  const generated = z.toJSONSchema(mirror.schema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;

  // Zod emits its own `$schema`; drop it so the spread below cannot silently
  // override the dialect this generator claims to produce.
  delete generated.$schema;

  // The leading keys are fixed. Everything after them is Zod's own emission
  // order, which is stable for a given Zod version but is not a guarantee
  // across upgrades: a Zod bump that reorders keys fails `schemas:check` on an
  // otherwise-unrelated diff, and `bun run schemas:sync` is the fix.
  //
  // `JSON.stringify(…, 2)` always expands arrays; Biome collapses short ones
  // onto a single line. Both tools are idempotent alone and non-terminating
  // together, so the generated target is excluded from Biome in `biome.json`
  // and this generator is its only formatter.
  const document = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: mirror.id,
    title: mirror.title,
    $comment: `Generated from ${mirror.source} by scripts/sync-schemas.ts. Do not edit; run \`${mirror.syncScript}\`. Cross-field invariants are enforced in Zod only and are not represented here.`,
    ...generated,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

export type SchemaMirrorCheckResult = {
  ok: boolean;
  missing: string[];
  stale: string[];
};

export async function checkSchemaMirrors(root: string): Promise<SchemaMirrorCheckResult> {
  const missing: string[] = [];
  const stale: string[] = [];

  for (const mirror of schemaMirrors) {
    let current: string;
    try {
      current = await readFile(path.join(root, mirror.target), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing.push(mirror.target);
        continue;
      }
      throw error;
    }

    if (current !== renderSchemaMirror(mirror)) stale.push(mirror.target);
  }

  return { ok: missing.length === 0 && stale.length === 0, missing, stale };
}

export async function syncSchemaMirrors(root: string): Promise<{ ok: true; changed: string[] }> {
  const changed: string[] = [];

  for (const mirror of schemaMirrors) {
    const rendered = renderSchemaMirror(mirror);
    const target = path.join(root, mirror.target);

    let current: string | undefined;
    try {
      current = await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (current === rendered) continue;

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, rendered);
    changed.push(mirror.target);
  }

  return { ok: true, changed };
}

async function main(args: string[]): Promise<void> {
  const mode = args[0];
  if (mode !== "--check" && mode !== "--write") {
    throw new Error("Usage: bun run scripts/sync-schemas.ts (--check | --write)");
  }

  const root = process.cwd();
  if (mode === "--write") {
    const { changed } = await syncSchemaMirrors(root);
    for (const target of changed) console.log(`regenerated ${target}`);
    return;
  }

  const result = await checkSchemaMirrors(root);
  if (!result.ok) {
    const detail = [
      ...result.missing.map((target) => `${target} is missing`),
      ...result.stale.map((target) => `${target} is stale`),
    ].join(", ");
    throw new Error(`${detail}; run \`bun run schemas:sync\` and commit the result.`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
