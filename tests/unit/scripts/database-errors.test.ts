import { classifyDatabaseError, databaseFailureMessage } from "../../../scripts/database-errors";

describe("database error classification", () => {
  it.each([
    ["missing-role", { code: "28000", message: 'role "loopworks" does not exist' }],
    ["missing-database", { code: "3D000", message: 'database "loopworks" does not exist' }],
    ["authentication", { code: "28P01", message: "password authentication failed" }],
    ["unreachable", { code: "ECONNREFUSED", message: "connect refused" }],
    ["unreachable", { code: "ETIMEDOUT", message: "connection timed out" }],
    ["unreachable", { code: "CONNECT_TIMEOUT", message: "connection attempt expired" }],
    ["permission", { code: "EPERM", message: "operation not permitted" }],
    ["permission", { code: "EACCES", message: "permission denied" }],
    ["unknown", new Error("postgres://loopworks:top-secret@127.0.0.1/loopworks")],
  ] as const)("classifies %s without exposing the input", (expected, error) => {
    expect(classifyDatabaseError(error)).toBe(expected);
    expect(databaseFailureMessage(expected, "seed")).not.toContain("top-secret");
  });

  it("walks nested causes used by socket and driver errors", () => {
    expect(
      classifyDatabaseError({
        message: "connection failed",
        cause: { code: "ECONNREFUSED", message: "secret-bearing low-level failure" },
      }),
    ).toBe("unreachable");
  });

  it.each([
    "missing-role",
    "missing-database",
    "authentication",
    "unreachable",
    "permission",
    "unknown",
  ] as const)("returns static actionable guidance for %s", (category) => {
    const message = databaseFailureMessage(category, "seed");
    expect(message).toContain("db:doctor");
    expect(message).not.toContain("postgres://");
  });
});
