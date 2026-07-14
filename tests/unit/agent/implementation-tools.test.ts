/** @vitest-environment node */
import { resolveImplementerFixtureMode } from "@agent/subagents/implementer/lib/fixture-mode";
import { createImplementationFixtureHandoff } from "@agent/implementation-fixture";
import {
  assertAllowedProductionFiles,
  assertProductionWriteNotClaimed,
  assertExactFocusedCommand,
  classifyGreenRun,
  createImplementationExecutionReceipt,
  redactImplementationOutput,
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
