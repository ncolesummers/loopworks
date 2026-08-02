const localDatabaseUrl = "postgres://loopworks:loopworks@127.0.0.1:5432/loopworks";

const neonMetadataKeys = [
  "NEON_BRANCH_ID",
  "NEON_DATABASE_NAME",
  "NEON_DATABASE_USERNAME",
  "NEON_PROJECT_ID",
] as const;

export type MigrationEnvironment = Readonly<Record<string, string | undefined>>;

function hasValue(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function isNeonHost(host: string | undefined): boolean {
  if (!hasValue(host)) return false;

  const normalizedHost = host.trim().toLowerCase();
  return normalizedHost === "neon.tech" || normalizedHost.endsWith(".neon.tech");
}

function urlUsesNeon(value: string | undefined): boolean {
  if (!hasValue(value)) return false;

  try {
    return isNeonHost(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
}

function parsePostgresUrl(value: string, variableName: string): URL {
  try {
    const parsedUrl = new URL(value.trim());
    if (
      (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") ||
      !parsedUrl.hostname
    ) {
      throw new Error("Unsupported database URL.");
    }
    return parsedUrl;
  } catch {
    throw new Error(`${variableName} must be a valid Postgres connection URL.`);
  }
}

function isPooledNeonHost(hostname: string): boolean {
  return isNeonHost(hostname) && hostname.split(".")[0]?.endsWith("-pooler") === true;
}

function neonDatabaseTarget(connectionUrl: URL): string | undefined {
  if (!isNeonHost(connectionUrl.hostname)) return undefined;

  const [endpoint, ...domain] = connectionUrl.hostname.toLowerCase().split(".");
  if (!endpoint) return undefined;

  const branchHost = [endpoint.replace(/-pooler$/, ""), ...domain].join(".");
  return `${branchHost}${connectionUrl.pathname}`;
}

function isHostedMigrationEnvironment(environment: MigrationEnvironment): boolean {
  const vercelEnvironment = environment.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnvironment === "production" || vercelEnvironment === "preview") {
    return true;
  }

  if (neonMetadataKeys.some((key) => hasValue(environment[key]))) {
    return true;
  }

  return (
    isNeonHost(environment.PGHOST) ||
    isNeonHost(environment.POSTGRES_HOST) ||
    urlUsesNeon(environment.DATABASE_URL) ||
    urlUsesNeon(environment.DATABASE_URL_UNPOOLED)
  );
}

export function resolveMigrationDatabaseUrl(environment: MigrationEnvironment): string {
  const directUrlValue = environment.DATABASE_URL_UNPOOLED;
  const runtimeUrlValue = environment.DATABASE_URL;
  const hostedEnvironment = isHostedMigrationEnvironment(environment);

  if (!hasValue(directUrlValue)) {
    if (hostedEnvironment) {
      throw new Error(
        "Hosted database migrations require a non-empty DATABASE_URL_UNPOOLED; refusing a pooled fallback.",
      );
    }

    if (hasValue(runtimeUrlValue)) {
      parsePostgresUrl(runtimeUrlValue, "DATABASE_URL");
      return runtimeUrlValue.trim();
    }

    return localDatabaseUrl;
  }

  const directUrl = parsePostgresUrl(directUrlValue, "DATABASE_URL_UNPOOLED");
  if (isPooledNeonHost(directUrl.hostname)) {
    throw new Error(
      "DATABASE_URL_UNPOOLED must use a direct Neon endpoint, not a pooled endpoint.",
    );
  }

  if (hostedEnvironment && !hasValue(runtimeUrlValue)) {
    throw new Error("Hosted application runtime requires a non-empty DATABASE_URL.");
  }

  if (hasValue(runtimeUrlValue)) {
    const runtimeUrl = parsePostgresUrl(runtimeUrlValue, "DATABASE_URL");
    const runtimeNeonTarget = neonDatabaseTarget(runtimeUrl);
    const migrationNeonTarget = neonDatabaseTarget(directUrl);

    if (hostedEnvironment && (!runtimeNeonTarget || !migrationNeonTarget)) {
      throw new Error(
        "Hosted database migrations require DATABASE_URL and DATABASE_URL_UNPOOLED to use Neon endpoints.",
      );
    }

    if (runtimeNeonTarget && !isPooledNeonHost(runtimeUrl.hostname)) {
      throw new Error("DATABASE_URL must use the pooled Neon endpoint in hosted deployments.");
    }

    if ((runtimeNeonTarget || migrationNeonTarget) && runtimeNeonTarget !== migrationNeonTarget) {
      throw new Error(
        "DATABASE_URL and DATABASE_URL_UNPOOLED must target the same Neon branch and database.",
      );
    }
  }

  return directUrlValue.trim();
}
