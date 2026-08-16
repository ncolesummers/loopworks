import { isIP } from "node:net";

import { readSuppliedRawConfig } from "@/lib/config/registry";
import { isProductionRuntime } from "@/lib/runtime";

export type LocalDatabaseSafetyOptions = {
  defaultUrl?: string;
  exactUrl?: string;
  requiredDatabaseName?: string;
  requireExplicitUrl?: boolean;
};

export type LocalDatabaseTarget = {
  databaseName: string;
  url: string;
  username: string;
};

export type LocalDatabaseTargetResolution = {
  error: string | null;
  target: LocalDatabaseTarget | null;
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
export function resolveLocalDatabaseTarget(
  env: Partial<NodeJS.ProcessEnv>,
  options: LocalDatabaseSafetyOptions = {},
): LocalDatabaseTargetResolution {
  if (isProductionRuntime(env)) {
    return {
      error:
        "Refusing local database mutation: this looks like a production environment " +
        "(NODE_ENV or VERCEL_ENV is 'production'), per ADR 0007.",
      target: null,
    };
  }

  const suppliedValue = readSuppliedRawConfig("DATABASE_URL", env);
  const value = suppliedValue ?? options.defaultUrl;
  if (suppliedValue !== undefined && options.exactUrl && suppliedValue !== options.exactUrl) {
    return {
      error:
        "Refusing local database mutation: this command accepts only the canonical Loopworks development database URL.",
      target: null,
    };
  }
  if (!value) {
    return {
      error: options.requireExplicitUrl
        ? "Refusing local database mutation: DATABASE_URL must explicitly identify a local Postgres database."
        : null,
      target: null,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      error: "Refusing local database mutation: DATABASE_URL is not a valid URL.",
      target: null,
    };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      error:
        "Refusing local database mutation: DATABASE_URL must use the postgres or postgresql scheme.",
      target: null,
    };
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return {
      error:
        "Refusing local database mutation: DATABASE_URL must point at a loopback host " +
        "(localhost/127.0.0.1/::1), per ADR 0007.",
      target: null,
    };
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (options.requiredDatabaseName) {
    if (databaseName.includes("%")) {
      return {
        error: "Refusing local database mutation: the database name must not use percent-encoding.",
        target: null,
      };
    }
    if (databaseName !== options.requiredDatabaseName) {
      return {
        error: `Refusing local database mutation: this command requires the dedicated ${options.requiredDatabaseName} database.`,
        target: null,
      };
    }
  }

  let decodedDatabaseName: string;
  let decodedUsername: string;
  try {
    decodedDatabaseName = decodeURIComponent(databaseName);
    decodeURIComponent(parsed.password);
    decodedUsername = decodeURIComponent(parsed.username);
  } catch {
    return {
      error: "Refusing local database mutation: DATABASE_URL contains invalid percent-encoding.",
      target: null,
    };
  }

  return {
    error: null,
    target: {
      databaseName: decodedDatabaseName,
      url: value,
      username: decodedUsername,
    },
  };
}

export function getLocalDatabaseSafetyError(
  env: Partial<NodeJS.ProcessEnv>,
  options: LocalDatabaseSafetyOptions = {},
): string | null {
  return resolveLocalDatabaseTarget(env, options).error;
}
