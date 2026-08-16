export type DatabaseErrorCategory =
  | "authentication"
  | "missing-database"
  | "missing-role"
  | "permission"
  | "unknown"
  | "unreachable";

type ErrorFields = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
};

function fields(error: unknown): ErrorFields {
  return typeof error === "object" && error !== null ? (error as ErrorFields) : {};
}

function classifyOne(error: unknown): DatabaseErrorCategory | null {
  const { code, message } = fields(error);
  const normalizedCode = typeof code === "string" ? code.toUpperCase() : "";
  const normalizedMessage = typeof message === "string" ? message.toLowerCase() : "";

  if (normalizedCode === "3D000" || /database .* does not exist/.test(normalizedMessage)) {
    return "missing-database";
  }
  if (/role .* does not exist/.test(normalizedMessage)) return "missing-role";
  if (
    normalizedCode === "28P01" ||
    normalizedCode === "28000" ||
    normalizedMessage.includes("authentication failed")
  ) {
    return "authentication";
  }
  if (normalizedCode === "EPERM" || normalizedCode === "EACCES") return "permission";
  if (
    [
      "CONNECT_TIMEOUT",
      "CONNECTION_TIMEOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ETIMEDOUT",
    ].includes(normalizedCode) ||
    normalizedMessage.includes("connection timed out") ||
    normalizedMessage.includes("connect timeout")
  ) {
    return "unreachable";
  }
  return null;
}

/** Classifies bounded driver fields without ever returning or logging the original error. */
export function classifyDatabaseError(
  error: unknown,
  seen: Set<unknown> = new Set(),
): DatabaseErrorCategory {
  if (seen.has(error)) return "unknown";
  seen.add(error);
  const direct = classifyOne(error);
  if (direct) return direct;
  const cause = fields(error).cause;
  return cause === undefined ? "unknown" : classifyDatabaseError(cause, seen);
}

export function databaseFailureMessage(
  category: DatabaseErrorCategory,
  operation: "bootstrap" | "doctor" | "seed",
): string {
  const prefix = operation === "seed" ? "Database seed failed." : `Database ${operation} failed.`;
  switch (category) {
    case "missing-role":
      return `${prefix} The configured role is missing. Run 'bun run db:bootstrap', then 'bun run db:doctor'.`;
    case "missing-database":
      return `${prefix} The configured database is missing. Run 'bun run db:bootstrap', then 'bun run db:doctor'.`;
    case "authentication":
      return `${prefix} Postgres rejected authentication. Verify local credentials, then run 'bun run db:doctor'.`;
    case "unreachable":
      return `${prefix} Start Postgres.app and confirm it is accepting loopback connections, then run 'bun run db:doctor'.`;
    case "permission":
      return `${prefix} The sandbox or operating system denied the local connection. Retry outside the sandbox, then run 'bun run db:doctor'.`;
    case "unknown":
      return `${prefix} Run 'bun run db:doctor' for sanitized diagnostics.`;
  }
}
