import { z } from "zod";

import { parseLoopworksPublicOrigin } from "@/lib/public-origin";
import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type ConfigRuntimeContext = "build" | "development" | "test" | "production";

export type ConfigGroup =
  | "agents"
  | "auth"
  | "database"
  | "github"
  | "observability"
  | "runtime"
  | "vercel";

export type ConfigValue = boolean | string | readonly string[] | undefined;

export type ConfigDefinition = {
  name: string;
  schema: z.ZodType<ConfigValue>;
  group: ConfigGroup;
  description: string;
  requiredIn: readonly ConfigRuntimeContext[];
  secret: boolean;
  readOnly: boolean;
  defaults?: Partial<Record<ConfigRuntimeContext, ConfigValue>>;
  exampleValue?: string;
};

export const authDevelopmentSecret = "loopworks-local-development-secret";
export const localDatabaseUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

const stringSchema = z.string();
const trimmedStringSchema = z.string().transform((value) => value.trim());
const truthySchema = z.string().transform(isTruthyEnvValue);
const enabledSchema = z.string().transform((value) => value.trim().toLowerCase() !== "false");
const csvSchema = z.string().transform((value) =>
  value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
const urlSchema = z.string().refine((value) => URL.canParse(value));
const optionalUrlSchema = z.union([z.literal(""), urlSchema]);
const postgresUrlSchema = urlSchema.refine((value) => {
  if (!URL.canParse(value)) return false;
  const protocol = new URL(value).protocol;
  return protocol === "postgres:" || protocol === "postgresql:";
});
const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]);
const portalDataModeSchema = z.enum(["", "fixtures"]);

const requiredInProduction = ["production"] as const;
const notRequired = [] as const;

function defineConfig<const Definition extends ConfigDefinition>(
  definition: Definition,
): Definition {
  return definition;
}

function defineRegistry<const Registry extends readonly ConfigDefinition[]>(
  registry: Registry,
): Registry {
  return registry;
}

export const configRegistry = defineRegistry([
  {
    name: "AUTH_SECRET",
    schema: stringSchema,
    group: "auth",
    description: "Auth.js session secret; generate with `npx auth secret` or OpenSSL.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    defaults: { development: authDevelopmentSecret, test: authDevelopmentSecret },
    exampleValue: "replace-with-auth-secret",
  },
  {
    name: "AUTH_GITHUB_ID",
    schema: stringSchema,
    group: "auth",
    description: "GitHub OAuth application client ID used for SSO sign-in.",
    requiredIn: requiredInProduction,
    secret: false,
    readOnly: false,
    defaults: {
      build: "missing-github-client-id",
      development: "missing-github-client-id",
      test: "missing-github-client-id",
    },
    exampleValue: "replace-with-github-oauth-client-id",
  },
  {
    name: "AUTH_GITHUB_SECRET",
    schema: stringSchema,
    group: "auth",
    description: "GitHub OAuth application client secret used for SSO sign-in.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    defaults: {
      build: "missing-github-client-secret",
      development: "missing-github-client-secret",
      test: "missing-github-client-secret",
    },
    exampleValue: "replace-with-github-oauth-client-secret",
  },
  {
    name: "LOOPWORKS_AUTH_BYPASS",
    schema: truthySchema,
    group: "auth",
    description: "Skip GitHub SSO authorization in non-production development only.",
    requiredIn: notRequired,
    secret: false,
    readOnly: false,
    defaults: { build: false, development: false, test: false, production: false },
    exampleValue: "false",
  },
  {
    name: "LOOPWORKS_ALLOWED_GITHUB_USERS",
    schema: csvSchema,
    group: "auth",
    description: "Comma-separated GitHub user login allowlist.",
    requiredIn: notRequired,
    secret: false,
    readOnly: false,
    defaults: { build: [], development: [], test: [], production: [] },
    exampleValue: "ncolesummers",
  },
  {
    name: "LOOPWORKS_ALLOWED_GITHUB_ORGS",
    schema: csvSchema,
    group: "auth",
    description: "Comma-separated GitHub organization allowlist.",
    requiredIn: notRequired,
    secret: false,
    readOnly: false,
    defaults: { build: [], development: [], test: [], production: [] },
    exampleValue: "",
  },
  {
    name: "DATABASE_URL",
    schema: postgresUrlSchema,
    group: "database",
    description: "Pooled Postgres connection URL used by application queries.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    defaults: {
      build: localDatabaseUrl,
      development: localDatabaseUrl,
      test: localDatabaseUrl,
    },
    exampleValue: localDatabaseUrl,
  },
  {
    name: "DATABASE_URL_UNPOOLED",
    schema: postgresUrlSchema,
    group: "database",
    description: "Direct Postgres connection URL used by deployment migrations.",
    requiredIn: notRequired,
    secret: true,
    readOnly: false,
    exampleValue: localDatabaseUrl,
  },
  {
    name: "LOOPWORKS_PUBLIC_URL",
    schema: urlSchema,
    group: "runtime",
    description: "Canonical portal origin used for durable run backlinks.",
    requiredIn: requiredInProduction,
    secret: false,
    readOnly: false,
    defaults: {
      build: "http://127.0.0.1:3000",
      development: "http://127.0.0.1:3000",
      test: "http://127.0.0.1:3000",
    },
    exampleValue: "http://127.0.0.1:3000",
  },
  ...(
    [
      ["LOOPWORKS_AGENT_READY_LOOP_ENABLED", "Fallback kill switch for webhook-triggered loops."],
      ["LOOPWORKS_DEVELOPMENT_LOOP_ENABLED", "Kill switch for development-loop webhook starts."],
      ["LOOPWORKS_RESEARCH_LOOP_ENABLED", "Kill switch for research-loop webhook starts."],
    ] as const
  ).map(([name, description]) =>
    defineConfig({
      name,
      schema: enabledSchema,
      group: "agents",
      description,
      requiredIn: notRequired,
      secret: false,
      readOnly: false,
      defaults: { build: true, development: true, test: true, production: true },
      exampleValue: "true",
    }),
  ),
  {
    name: "LOOPWORKS_PORTAL_DATA_MODE",
    schema: portalDataModeSchema,
    group: "runtime",
    description: "Serve canned portal data in non-production when set to fixtures.",
    requiredIn: notRequired,
    secret: false,
    readOnly: false,
    exampleValue: "",
  },
  {
    name: "LOOPWORKS_EVE_TEST_RECEIPT_SECRET",
    schema: stringSchema,
    group: "agents",
    description: "HMAC secret used to sign stage execution receipts.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    exampleValue: "replace-with-test-receipt-secret",
  },
  ...(
    [
      ["LOOPWORKS_EVE_FIXTURE_MODE", "Replay the planning-agent fixture in non-production."],
      [
        "LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE",
        "Replay the test-writer fixture in non-production.",
      ],
      [
        "LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE",
        "Replay the implementation fixture in non-production.",
      ],
      [
        "LOOPWORKS_EVE_VALIDATION_REVIEWER_FIXTURE_MODE",
        "Replay the validation-review fixture in non-production.",
      ],
      [
        "LOOPWORKS_EVE_PR_PREPARER_FIXTURE_MODE",
        "Replay the PR-preparation fixture in non-production.",
      ],
      ["LOOPWORKS_EVE_CAPTURE_IO", "Allow raw agent I/O capture in non-production."],
    ] as const
  ).map(([name, description]) =>
    defineConfig({
      name,
      schema: truthySchema,
      group: "agents",
      description,
      requiredIn: notRequired,
      secret: false,
      readOnly: false,
      defaults: { build: false, development: false, test: false, production: false },
      exampleValue: "false",
    }),
  ),
  {
    name: "LOG_LEVEL",
    schema: logLevelSchema,
    group: "observability",
    description: "Pino log level.",
    requiredIn: notRequired,
    secret: false,
    readOnly: false,
    defaults: { build: "info", development: "info", test: "info", production: "info" },
    exampleValue: "info",
  },
  ...(
    [
      ["OTEL_EXPORTER_OTLP_PROTOCOL", "OTLP exporter protocol.", false, "http/protobuf"],
      [
        "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
        "Metrics-specific OTLP exporter protocol.",
        false,
        "http/protobuf",
      ],
      ["OTEL_EXPORTER_OTLP_ENDPOINT", "Shared OTLP exporter endpoint.", false, ""],
      ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "Trace-specific OTLP endpoint.", false, ""],
      ["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "Metrics-specific OTLP endpoint.", false, ""],
      ["OTEL_EXPORTER_OTLP_LOGS_ENDPOINT", "Logs-specific OTLP endpoint.", false, ""],
      ["OTEL_EXPORTER_OTLP_HEADERS", "Shared OTLP exporter authentication headers.", true, ""],
      ["OTEL_EXPORTER_OTLP_TRACES_HEADERS", "Trace exporter authentication headers.", true, ""],
      ["OTEL_EXPORTER_OTLP_METRICS_HEADERS", "Metrics exporter authentication headers.", true, ""],
      ["OTEL_SERVICE_NAME", "OTel service name override.", false, "loopworks"],
      ["OTEL_RESOURCE_ATTRIBUTES", "Additional OTel resource key-value pairs.", false, ""],
    ] as const
  ).map(([name, description, secret, exampleValue]) =>
    defineConfig({
      name,
      schema: name.endsWith("ENDPOINT") ? optionalUrlSchema : stringSchema,
      group: "observability",
      description,
      requiredIn: notRequired,
      secret,
      readOnly: false,
      ...(name === "OTEL_EXPORTER_OTLP_PROTOCOL" || name === "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL"
        ? {
            defaults: {
              build: "http/protobuf",
              development: "http/protobuf",
              test: "http/protobuf",
              production: "http/protobuf",
            },
          }
        : name === "OTEL_SERVICE_NAME"
          ? {
              defaults: {
                build: "loopworks",
                development: "loopworks",
                test: "loopworks",
                production: "loopworks",
              },
            }
          : {}),
      exampleValue,
    }),
  ),
  {
    name: "GITHUB_APP_ID",
    schema: trimmedStringSchema,
    group: "github",
    description: "GitHub App identifier used for issue and pull-request automation.",
    requiredIn: requiredInProduction,
    secret: false,
    readOnly: false,
    exampleValue: "",
  },
  {
    name: "GITHUB_APP_CLIENT_ID",
    schema: trimmedStringSchema,
    group: "github",
    description: "GitHub App client ID used for installation user verification.",
    requiredIn: requiredInProduction,
    secret: false,
    readOnly: false,
    exampleValue: "replace-with-github-app-client-id",
  },
  {
    name: "GITHUB_APP_CLIENT_SECRET",
    schema: stringSchema,
    group: "github",
    description: "GitHub App client secret used for installation user verification.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    exampleValue: "replace-with-github-app-client-secret",
  },
  {
    name: "GITHUB_APP_PRIVATE_KEY",
    schema: trimmedStringSchema,
    group: "github",
    description: "GitHub App PEM private key; escaped newlines are accepted.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    exampleValue: "",
  },
  {
    name: "GITHUB_APP_SLUG",
    schema: trimmedStringSchema,
    group: "github",
    description: "GitHub App slug used to build the operator installation URL.",
    requiredIn: requiredInProduction,
    secret: false,
    readOnly: false,
    exampleValue: "replace-with-github-app-slug",
  },
  {
    name: "GITHUB_WEBHOOK_SECRET",
    schema: stringSchema,
    group: "github",
    description: "Secret used to verify and generate GitHub webhook signatures.",
    requiredIn: requiredInProduction,
    secret: true,
    readOnly: false,
    exampleValue: "dev-webhook-secret",
  },
  ...(
    [
      ["VERCEL_ACCESS_TOKEN", "Vercel API access token used for deployment visibility.", true],
      ["VERCEL_TEAM_ID", "Optional Vercel team identifier.", false],
      ["VERCEL_TEAM_SLUG", "Optional Vercel team slug.", false],
    ] as const
  ).map(([name, description, secret]) =>
    defineConfig({
      name,
      schema: stringSchema,
      group: "vercel",
      description,
      requiredIn: notRequired,
      secret,
      readOnly: false,
      exampleValue: "",
    }),
  ),
  ...(
    [
      ["CI", "Continuous-integration runtime observation."],
      ["NEXT_PHASE", "Next.js lifecycle phase observation."],
      ["NEXT_RUNTIME", "Next.js server runtime observation."],
      ["NODE_ENV", "Node.js runtime mode observation."],
      ["VERCEL_ENV", "Vercel deployment environment observation."],
      ["VERCEL_DEPLOYMENT_ID", "Vercel deployment identifier observation."],
      ["VERCEL_GIT_COMMIT_SHA", "Vercel Git commit SHA observation."],
      ["VERCEL_GIT_REPO_OWNER", "Vercel Git repository owner observation."],
      ["VERCEL_GIT_REPO_SLUG", "Vercel Git repository slug observation."],
      ["VERCEL_PROJECT_PRODUCTION_URL", "Vercel production domain observation."],
      ["VERCEL_REGION", "Vercel execution region observation."],
      ["VERCEL_URL", "Vercel deployment domain observation."],
      ["NEON_BRANCH_ID", "Neon branch identifier observation."],
      ["NEON_DATABASE_NAME", "Neon database name observation."],
      ["NEON_DATABASE_USERNAME", "Neon database user observation."],
      ["NEON_PROJECT_ID", "Neon project identifier observation."],
      ["PGHOST", "Postgres host observation supplied by providers."],
      ["POSTGRES_HOST", "Postgres host observation supplied by providers."],
    ] as const
  ).map(([name, description]) =>
    defineConfig({
      name,
      schema: stringSchema,
      group: "runtime",
      description,
      requiredIn: notRequired,
      secret: false,
      readOnly: true,
    }),
  ),
]);

const registryByName: ReadonlyMap<string, ConfigDefinition> = new Map(
  configRegistry.map((definition) => [definition.name, definition]),
);

export type ConfigName = (typeof configRegistry)[number]["name"];

type ConfigNameWithOutput<Output> = (typeof configRegistry)[number] extends infer Definition
  ? Definition extends {
      name: infer Name extends ConfigName;
      schema: infer Schema extends z.ZodType;
    }
    ? z.output<Schema> extends Output
      ? Name
      : never
    : never
  : never;

export type StringConfigName = ConfigNameWithOutput<string>;
export type BooleanConfigName = ConfigNameWithOutput<boolean>;
export type StringListConfigName = ConfigNameWithOutput<readonly string[]>;

export function isConfigName(name: string): name is ConfigName {
  return registryByName.has(name);
}

export function resolveConfigRuntimeContext(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ConfigRuntimeContext {
  if (env.NEXT_PHASE === "phase-production-build") return "build";
  if (env.NODE_ENV === "test") return "test";
  if (isProductionRuntime(env)) return "production";
  return "development";
}

function configError(definition: ConfigDefinition, reason: string): Error {
  return new Error(`${definition.name} (${definition.group}): ${reason}`);
}

export function readConfigValue(
  name: ConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
  options: { enforceRequired?: boolean; useDefault?: boolean } = {},
): ConfigValue {
  const definition = registryByName.get(name);
  if (!definition) throw new Error(`Unknown configuration variable: ${name}`);

  const rawValue = env[name];
  const absent = rawValue === undefined;
  if (
    options.enforceRequired !== false &&
    (absent || rawValue.trim() === "") &&
    definition.requiredIn.includes(context)
  ) {
    throw configError(definition, "value is required");
  }

  if (absent) return options.useDefault === false ? undefined : definition.defaults?.[context];

  if (
    name === "AUTH_SECRET" &&
    context === "production" &&
    rawValue.trim() === authDevelopmentSecret
  ) {
    throw configError(definition, "development fallback is forbidden in production");
  }

  if (
    context === "production" &&
    definition.requiredIn.includes("production") &&
    definition.exampleValue &&
    rawValue.trim() === definition.exampleValue.trim()
  ) {
    throw configError(definition, "generated example value is forbidden in production");
  }

  const result = definition.schema.safeParse(rawValue);
  if (!result.success) throw configError(definition, "value is invalid");
  if (name === "LOOPWORKS_PUBLIC_URL") {
    try {
      parseLoopworksPublicOrigin(rawValue, {
        NODE_ENV: context === "production" ? "production" : "development",
      });
    } catch (error) {
      throw configError(definition, error instanceof Error ? error.message : "value is invalid");
    }
  }
  return result.data;
}

export function readStringConfig(
  name: StringConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): string | undefined {
  const value = readConfigValue(name, env, context);
  if (value === undefined || typeof value === "string") return value;
  throw new Error(`${name}: registry schema did not return a string`);
}

export function readSuppliedStringConfig(
  name: StringConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): string | undefined {
  const value = readConfigValue(name, env, context, {
    enforceRequired: false,
    useDefault: false,
  });
  if (value === undefined || typeof value === "string") return value;
  throw new Error(`${name}: registry schema did not return a string`);
}

export function readSuppliedRawConfig(
  name: ConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): string | undefined {
  if (!registryByName.has(name)) throw new Error(`Unknown configuration variable: ${name}`);
  return env[name];
}

export function readBooleanConfig(
  name: BooleanConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): boolean {
  const value = readConfigValue(name, env, context);
  if (typeof value === "boolean") return value;
  throw new Error(`${name}: registry schema did not return a boolean`);
}

export function readSuppliedBooleanConfig(
  name: BooleanConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): boolean | undefined {
  const value = readConfigValue(name, env, context, {
    enforceRequired: false,
    useDefault: false,
  });
  if (value === undefined || typeof value === "boolean") return value;
  throw new Error(`${name}: registry schema did not return a boolean`);
}

export function readStringListConfig(
  name: StringListConfigName,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): string[] {
  const value = readConfigValue(name, env, context);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return [...value];
  throw new Error(`${name}: registry schema did not return a string list`);
}

export function validateConfig(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  context: ConfigRuntimeContext = resolveConfigRuntimeContext(env),
): void {
  const issues: string[] = [];

  for (const definition of configRegistry) {
    try {
      readConfigValue(definition.name, env, context);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `${definition.name}: value is invalid`);
    }
  }

  if (issues.length > 0) {
    throw new Error(`Configuration validation failed:\n${issues.join("\n")}`);
  }
}
