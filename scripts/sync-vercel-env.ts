import { readFile } from "node:fs/promises";
import { resolveMigrationDatabaseUrl } from "@/db/neon-migration-config";
import {
  assertPreviewStoreIdentityIsNotProduction,
  productionStoreIdentityFingerprint,
} from "@/db/store-identity-fingerprint";
import {
  type ConfigRuntimeContext,
  configRegistry,
  isConfigName,
  readConfigValue,
} from "@/lib/config/registry";

export type VercelTargetEnvironment = "preview" | "production";

/**
 * Declared in the env file, stripped before anything reaches Vercel. It exists
 * so copying `production` values into `--write preview` fails loudly instead of
 * handing a preview deployment the production GitHub App private key.
 */
export const envTargetDirective = "LOOPWORKS_ENV_TARGET";

/**
 * Production retains Vercel integration ownership of its database URLs. Preview
 * is deliberately excluded: it owns a fixed, disposable database in a separate
 * Neon project (ADR 0035), so its URLs must be supplied explicitly per target.
 */
export const productionIntegrationOwnedConfigNames = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
] as const;

/**
 * A fixed Preview database can be identified deterministically. Require its
 * pooled runtime URL, direct migration URL, and expected store identity in the
 * Preview file. The migration runner independently verifies that identity from
 * the target database before applying Preview migrations.
 */
export const previewOwnedConfigNames = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "LOOPWORKS_EXPECTED_STORE_ID",
  "LOOPWORKS_PREVIEW_GITHUB_TOKEN",
] as const;

/**
 * Reviewed SHA-256 trust root for Production's store identity. The underlying
 * identity is intentionally never checked in: Preview compares only a supplied
 * identity's digest so a copied Production configuration is rejected before a
 * credential can be written to Vercel.
 */
export { assertPreviewStoreIdentityIsNotProduction, productionStoreIdentityFingerprint };

const vercelTargetEnvironments = ["preview", "production"] as const;

export function isVercelTargetEnvironment(value: string): value is VercelTargetEnvironment {
  return (vercelTargetEnvironments as readonly string[]).includes(value);
}

/**
 * A Vercel Preview deployment runs with `NODE_ENV=production`, so
 * `resolveConfigRuntimeContext` classifies it as `production` and
 * `instrumentation.register()` enforces the full production set before
 * middleware. Preview and Production therefore share one contract; a variable
 * missing from Preview 500s every route exactly as it does in Production.
 */
export function requiredVercelConfigNames(
  target: VercelTargetEnvironment = "production",
): string[] {
  const required = configRegistry
    .filter(
      (definition) =>
        (definition.requiredIn as readonly ConfigRuntimeContext[]).includes("production") &&
        !definition.readOnly &&
        !(
          target === "production" &&
          (productionIntegrationOwnedConfigNames as readonly string[]).includes(definition.name)
        ),
    )
    .map((definition) => definition.name);

  if (target !== "preview") return required;

  return [...new Set([...required, ...previewOwnedConfigNames])];
}

/**
 * Reads the name column of `vercel env ls <target>`. Names are matched on the
 * leading uppercase convention, which excludes the lowercase `name` header and
 * the surrounding CLI chrome. The value column is never captured.
 */
export function parseVercelEnvNames(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s+([A-Z][A-Z0-9_]*)\s{2,}\S/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

export function diffVercelEnv(input: { required: readonly string[]; present: readonly string[] }): {
  missing: string[];
  present: string[];
} {
  const present = new Set(input.present);
  return {
    missing: input.required.filter((name) => !present.has(name)),
    present: input.required.filter((name) => present.has(name)),
  };
}

export function assertVercelTargetHasNoPreviewOnlyNames(
  present: readonly string[],
  target: VercelTargetEnvironment,
): void {
  if (target === "production" && present.includes("LOOPWORKS_PREVIEW_GITHUB_TOKEN")) {
    fail("LOOPWORKS_PREVIEW_GITHUB_TOKEN is Preview-only and must not be active in Production.");
  }
}

/**
 * The Vercel CLI exposes replacement as remove-then-add, which can erase a
 * working environment when the add fails. This writer only initializes an empty
 * target: callers must update existing values through an explicitly authorized
 * operator procedure, never by replacing them in a loop.
 */
export function assertVercelEnvWriteCanInitialize(input: {
  present: readonly string[];
  names: readonly string[];
  target: VercelTargetEnvironment;
}): void {
  const present = new Set(input.present);
  const existing = input.names.filter((name) => present.has(name));
  if (existing.length > 0) {
    fail(
      `Refusing to replace existing ${input.target} environment variables: ${existing.join(", ")}. Update them through an explicitly authorized operator procedure.`,
    );
  }
}

type VercelEnvCommandRunner = (command: string[], value?: string) => { exitCode: number };

/**
 * Initialize absent variables only. If an add fails, remove only the values
 * added by this invocation in reverse order; preflight has already proven that
 * none existed, so this can never erase a working target value.
 */
export function initializeVercelEnvironment(input: {
  entries: ReadonlyMap<string, string>;
  runCommand: VercelEnvCommandRunner;
  target: VercelTargetEnvironment;
}): void {
  const added: string[] = [];
  for (const [name, value] of input.entries) {
    const result = input.runCommand(["vercel", "env", "add", name, input.target, "--yes"], value);
    if (result.exitCode === 0) {
      added.push(name);
      continue;
    }

    const rollbackFailures = added
      .reverse()
      .filter(
        (addedName) =>
          input.runCommand(["vercel", "env", "rm", addedName, input.target, "--yes"]).exitCode !==
          0,
      );
    if (rollbackFailures.length > 0) {
      throw new Error(
        `Failed to initialize ${name} in ${input.target}; rollback failed for ${rollbackFailures.join(", ")}. Existing values were not replaced.`,
      );
    }
    throw new Error(
      `Failed to initialize ${name} in ${input.target}; rolled back ${added.join(", ") || "no new values"}. Existing values were not replaced.`,
    );
  }
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed.at(0);
  if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote || trimmed.length < 2) {
    return trimmed;
  }
  // Escaped newlines keep a PEM private key on one line, as `vercel-env.example`
  // documents for `GITHUB_APP_PRIVATE_KEY`.
  return trimmed
    .slice(1, -1)
    .replace(/\\(.)/g, (_, character: string) =>
      character === "n" ? "\n" : character === "t" ? "\t" : character,
    );
}

export function parseEnvFile(content: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    entries.set(match[1], unquote(match[2]));
  }
  return entries;
}

function fail(reason: string): never {
  throw new Error(reason);
}

/**
 * Validates an operator env file against the registry before any value leaves
 * the machine. Diagnostics name variables and never echo their values, so the
 * output is safe to paste into an issue.
 */
export function validateVercelEnvFile(
  content: string,
  target: VercelTargetEnvironment,
): Map<string, string> {
  const entries = parseEnvFile(content);

  const declaredTarget = entries.get(envTargetDirective);
  if (!declaredTarget) {
    fail(`Env file must declare ${envTargetDirective}="${target}".`);
  }
  if (declaredTarget !== target) {
    fail(`Env file declares target "${declaredTarget}", refusing to write to "${target}".`);
  }
  entries.delete(envTargetDirective);

  const unknown = [...entries.keys()].filter((name) => !isConfigName(name));
  if (unknown.length > 0) {
    fail(`Env file declares names absent from the configuration registry: ${unknown.join(", ")}.`);
  }

  const providerManaged = (
    target === "production" ? productionIntegrationOwnedConfigNames : []
  ).filter((name) => entries.has(name));
  if (providerManaged.length > 0) {
    fail(
      `The Production Vercel-managed Neon integration owns ${providerManaged.join(", ")}; remove them from the env file.`,
    );
  }

  assertVercelTargetHasNoPreviewOnlyNames([...entries.keys()], target);

  const missing = diffVercelEnv({
    required: requiredVercelConfigNames(target),
    present: [...entries.keys()].filter((name) => entries.get(name) !== ""),
  }).missing;
  if (missing.length > 0) {
    fail(`Env file is missing required variables: ${missing.join(", ")}.`);
  }

  // A preview that skips the application's own GitHub authorization proves
  // nothing about the auth boundary, so the bypass may never be enabled here.
  if (entries.get("LOOPWORKS_AUTH_BYPASS") && entries.get("LOOPWORKS_AUTH_BYPASS") !== "false") {
    fail(`LOOPWORKS_AUTH_BYPASS must stay disabled in ${target}; it removes the auth boundary.`);
  }
  if (
    !entries.get("LOOPWORKS_ALLOWED_GITHUB_USERS") &&
    !entries.get("LOOPWORKS_ALLOWED_GITHUB_ORGS")
  ) {
    fail(
      `${target} needs a non-empty GitHub user or organization allowlist; an empty allowlist admits every GitHub account.`,
    );
  }

  // GitHub App settings show the numeric App ID directly above the Client ID,
  // and both client fields silently accept the wrong one. The failure surfaces
  // only after a redeploy, as an opaque GitHub 404 at /login/oauth/authorize.
  for (const name of ["AUTH_GITHUB_ID", "GITHUB_APP_CLIENT_ID"] as const) {
    const value = entries.get(name);
    if (value && /^\d+$/.test(value)) {
      fail(`${name} looks like the App ID; use the App's Client ID (for example Iv23li...).`);
    }
  }

  // The example documents a `$(awk ...)` one-liner for the PEM, which stores the
  // command text verbatim when pasted into the file rather than run in a shell.
  // The App JWT then fails at runtime as an opaque /settings?github=error.
  const privateKey = entries.get("GITHUB_APP_PRIVATE_KEY");
  if (privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    fail(
      "GITHUB_APP_PRIVATE_KEY is not a PEM; paste the key file's contents, not a path or an unevaluated shell command.",
    );
  }

  // Registry validation in the production context, which is the context a
  // Preview deployment actually resolves to. Rejects malformed values, the
  // generated example placeholders, and non-HTTPS public origins locally
  // instead of after a deploy 500s.
  const environment = Object.fromEntries(entries);
  for (const name of entries.keys()) {
    if (isConfigName(name)) readConfigValue(name, environment, "production");
  }

  if (target === "preview") {
    if (!entries.get("LOOPWORKS_PREVIEW_GITHUB_TOKEN")?.trim()) {
      fail("Preview environment is missing LOOPWORKS_PREVIEW_GITHUB_TOKEN.");
    }
    const expectedStoreIdentity = entries.get("LOOPWORKS_EXPECTED_STORE_ID");
    if (!expectedStoreIdentity) {
      fail("Preview environment is missing LOOPWORKS_EXPECTED_STORE_ID.");
    }
    assertPreviewStoreIdentityIsNotProduction(expectedStoreIdentity);
    // This is validation only: it parses the pair and rejects role or target
    // mismatches before a credential is written. Its errors intentionally name
    // variables rather than echoing either connection string.
    resolveMigrationDatabaseUrl({ ...environment, VERCEL_ENV: "preview" });
  }

  return entries;
}

async function main(argv: readonly string[]): Promise<void> {
  const [mode, target, ...rest] = argv;
  if ((mode !== "--check" && mode !== "--write") || !target || !isVercelTargetEnvironment(target)) {
    throw new Error(
      "Usage: bun run scripts/sync-vercel-env.ts (--check | --write) (preview | production) [--file <env-file>]",
    );
  }

  if (mode === "--check") {
    const listing = Bun.spawnSync(["vercel", "env", "ls", target]);
    if (listing.exitCode !== 0) {
      throw new Error(`vercel env ls ${target} failed; run 'vercel link' in the repository first.`);
    }
    const present = parseVercelEnvNames(listing.stdout.toString());
    assertVercelTargetHasNoPreviewOnlyNames(present, target);
    const diff = diffVercelEnv({
      required: requiredVercelConfigNames(target),
      present,
    });
    if (diff.missing.length === 0) {
      console.log(`${target}: all ${diff.present.length} required variables are set.`);
      return;
    }
    throw new Error(
      `${target} is missing ${diff.missing.length} required variables:\n  ${diff.missing.join("\n  ")}`,
    );
  }

  const fileFlag = rest.indexOf("--file");
  const filePath = fileFlag === -1 ? undefined : rest[fileFlag + 1];
  if (!filePath) throw new Error("--write requires --file <env-file>.");

  const entries = validateVercelEnvFile(await readFile(filePath, "utf8"), target);
  const listing = Bun.spawnSync(["vercel", "env", "ls", target]);
  if (listing.exitCode !== 0) {
    throw new Error(`vercel env ls ${target} failed; refusing to write without a safe preflight.`);
  }
  assertVercelEnvWriteCanInitialize({
    present: parseVercelEnvNames(listing.stdout.toString()),
    names: [...entries.keys()],
    target,
  });
  initializeVercelEnvironment({
    entries,
    target,
    runCommand: (command, value) => {
      const result = Bun.spawnSync(command, {
        ...(value === undefined ? {} : { stdin: new TextEncoder().encode(value) }),
      });
      return { exitCode: result.exitCode };
    },
  });
  console.log(`\nRedeploy so the values apply: vercel redeploy <${target}-deployment-id>`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
