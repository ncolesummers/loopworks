import { isIP } from "node:net";

import { isProductionRuntime } from "@/lib/runtime";

export type LocalDatabaseSafetyOptions = {
  requiredDatabaseName?: string;
  requireExplicitUrl?: boolean;
};

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    (isIP(hostname) === 4 && hostname.split(".")[0] === "127")
  );
}

/**
 * Returns a sanitized reason when a database target is unsafe for local
 * mutation. The URL itself is never included because it may contain credentials.
 */
export function getLocalDatabaseSafetyError(
  env: Partial<NodeJS.ProcessEnv>,
  options: LocalDatabaseSafetyOptions = {},
): string | null {
  if (isProductionRuntime(env)) {
    return (
      "Refusing local database mutation: this looks like a production environment " +
      "(NODE_ENV or VERCEL_ENV is 'production'), per ADR 0007."
    );
  }

  const value = env.DATABASE_URL;
  if (!value) {
    return options.requireExplicitUrl
      ? "Refusing local database mutation: DATABASE_URL must explicitly identify a local Postgres database."
      : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Refusing local database mutation: DATABASE_URL is not a valid URL.";
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return "Refusing local database mutation: DATABASE_URL must use the postgres or postgresql scheme.";
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return (
      "Refusing local database mutation: DATABASE_URL must point at a loopback host " +
      "(localhost/127.0.0.1/::1), per ADR 0007."
    );
  }

  if (options.requiredDatabaseName) {
    const databaseName = parsed.pathname.replace(/^\//, "");
    if (databaseName.includes("%")) {
      return "Refusing local database mutation: the database name must not use percent-encoding.";
    }
    if (databaseName !== options.requiredDatabaseName) {
      return `Refusing local database mutation: this command requires the dedicated ${options.requiredDatabaseName} database.`;
    }
  }

  return null;
}
