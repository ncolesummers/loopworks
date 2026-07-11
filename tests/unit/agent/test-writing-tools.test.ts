/** @vitest-environment node */
import { resolveTestWriterFixtureMode } from "../../../agent/subagents/test-writer/lib/fixture-mode";
import {
  assertAllowedTestFiles,
  assertCommandMatchesPlannedTests,
  classifyTestRun,
  redactTestOutput,
} from "../../../agent/subagents/test-writer/lib/tool-policy";

describe("test-writer fixture mode", () => {
  it("is explicit, local-only, and fail-closed in production", () => {
    expect(resolveTestWriterFixtureMode({})).toEqual({ enabled: false, reason: "not_requested" });
    expect(
      resolveTestWriterFixtureMode({
        LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE: "true",
        NODE_ENV: "development",
      }),
    ).toEqual({ enabled: true, reason: "explicit_non_production_fixture" });
    expect(
      resolveTestWriterFixtureMode({
        LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE: "true",
        VERCEL_ENV: "production",
      }),
    ).toEqual({ enabled: false, reason: "production_runtime_blocked" });
  });
});

describe("test-writer command and output policy", () => {
  it("binds the exact command to approved test paths and test type", () => {
    expect(() =>
      assertCommandMatchesPlannedTests("bun run test -- tests/unit/a.test.ts", [
        { path: "tests/unit/a.test.ts", type: "unit" },
      ]),
    ).not.toThrow();
    expect(() =>
      assertCommandMatchesPlannedTests("bunx playwright test tests/e2e/a.spec.ts", [
        { path: "tests/e2e/a.spec.ts", type: "browser" },
      ]),
    ).not.toThrow();
    expect(() =>
      assertCommandMatchesPlannedTests("bun run test -- ../../evil.test.ts", [
        { path: "../../evil.test.ts", type: "unit" },
      ]),
    ).toThrow("Unsafe test artifact path");
    expect(() =>
      assertCommandMatchesPlannedTests("bun run test -- tests/unit/a.test.ts --preload ./evil.ts", [
        { path: "tests/unit/a.test.ts", type: "unit" },
      ]),
    ).toThrow();
    expect(() =>
      assertCommandMatchesPlannedTests("bun run test -- tests/unit/a.test.ts tests/e2e/a.spec.ts", [
        { path: "tests/unit/a.test.ts", type: "unit" },
        { path: "tests/e2e/a.spec.ts", type: "browser" },
      ]),
    ).toThrow("must run separately");
  });

  it("rejects unsafe writes and redacts credential-shaped output", () => {
    expect(() => assertAllowedTestFiles([{ path: "src/lib/runtime.ts" }])).toThrow();
    expect(() => assertAllowedTestFiles([{ path: "tests/unit/a.test.ts" }])).not.toThrow();
    const redacted = redactTestOutput(
      "authorization: Bearer abc123\nAPI_TOKEN=secret-value\nghp_abcdefghijklmnopqrstuvwxyz",
    );
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).toContain("[REDACTED]");
  });

  it("does not classify setup, crash, timeout, or unrelated output as expected red", () => {
    expect(
      classifyTestRun({
        exitCode: 1,
        output: "Cannot find module x\nexpected false to be true",
        expectedAssertions: ["expected false to be true"],
        testPaths: ["tests/unit/a.test.ts"],
      }),
    ).toBe("invalid_failure");
    expect(
      classifyTestRun({
        exitCode: 1,
        output: "tests/unit/a.test.ts\nexpected false to be true",
        expectedAssertions: ["expected false to be true"],
        testPaths: ["tests/unit/a.test.ts"],
      }),
    ).toBe("expected_failure");
  });
});
