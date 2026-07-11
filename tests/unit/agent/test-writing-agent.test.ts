/** @vitest-environment node */
import { createHash } from "node:crypto";

import {
  computeTestPlanDigest,
  isAllowedFocusedTestCommand,
  isAllowedTestArtifactPath,
  redTestEvidenceSchemaId,
  testPlanSchemaId,
  testWriterModelLabel,
  testWritingAgentOutputSchema,
} from "@agent/test-writing-agent";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reverseKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, reverseKeyOrder(entry)]),
    );
  }
  return value;
}

const patch = [
  "diff --git a/tests/unit/example.test.ts b/tests/unit/example.test.ts",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/tests/unit/example.test.ts",
  "@@ -0,0 +1 @@",
  "+expect(actual).toBe(expected);",
].join("\n");

function validOutput() {
  const testPlan = {
    version: 1 as const,
    schemaId: testPlanSchemaId,
    plan: {
      id: "plan-47",
      sha256: sha256("plan-47"),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
    },
    acceptanceCriteria: [
      { id: "ac-1", text: "Red evidence is tied to the plan." },
      { id: "ac-2", text: "The test plan is reusable downstream." },
    ],
    tests: [
      {
        id: "test-red-evidence",
        acceptanceCriterionIds: ["ac-1", "ac-2"],
        type: "unit" as const,
        path: "tests/unit/example.test.ts",
        command: "bun run test -- tests/unit/example.test.ts",
        steps: ["Run the focused contract test."],
        expectedFailure: { kind: "assertion" as const, message: "expected false to be true" },
        fixtureIds: ["approved-plan"],
      },
    ],
    fixtures: [
      {
        id: "approved-plan",
        kind: "fixture" as const,
        description: "Approved plan fixture.",
        data: { approved: true },
      },
    ],
    patch: {
      format: "unified-diff" as const,
      content: patch,
      sha256: sha256(patch),
      byteCount: Buffer.byteLength(patch),
      paths: ["tests/unit/example.test.ts"],
    },
  };

  return {
    model: testWriterModelLabel,
    testPlan,
    redEvidence: {
      version: 1 as const,
      schemaId: redTestEvidenceSchemaId,
      planId: testPlan.plan.id,
      planSha256: testPlan.plan.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      results: [
        {
          id: "red-1",
          testId: "test-red-evidence",
          acceptanceCriterionIds: ["ac-1", "ac-2"],
          command: "bun run test -- tests/unit/example.test.ts",
          outcome: "expected_failure" as const,
          exitCode: 1,
          durationMs: 25,
          expectedAssertion: "expected false to be true",
          executionReceipt: "c".repeat(64),
          outputReference: {
            uri: "artifact://redacted/red-1.log",
            sha256: sha256("redacted output"),
            byteCount: 15,
            redacted: true as const,
          },
        },
      ],
    },
  };
}

describe("Test-writing artifact contract", () => {
  it("computes the same test-plan digest regardless of JSON key order", () => {
    const testPlan = validOutput().testPlan;

    expect(computeTestPlanDigest(reverseKeyOrder(testPlan))).toBe(computeTestPlanDigest(testPlan));
  });

  it("accepts a complete AC-mapped test plan and expected-red evidence", () => {
    expect(testWritingAgentOutputSchema.parse(validOutput())).toMatchObject({
      model: "openai/gpt-5.6-terra-xhigh",
      testPlan: { schemaId: "loopworks.test_plan.v1" },
      redEvidence: { schemaId: "loopworks.red_test_evidence.v1" },
    });
  });

  it("rejects duplicate IDs and evidence that references unknown criteria", () => {
    const duplicate = validOutput();
    duplicate.testPlan.acceptanceCriteria.push({
      id: "ac-1",
      text: "Duplicate criterion.",
    });
    duplicate.redEvidence.results[0]?.acceptanceCriterionIds.push("ac-missing");

    const parsed = testWritingAgentOutputSchema.safeParse(duplicate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Duplicate acceptance criterion"),
          expect.stringContaining("unknown acceptance criterion"),
        ]),
      );
    }
  });

  it("binds evidence and the persisted patch to the exact planned test", () => {
    const mismatchedEvidence = validOutput();
    const evidence = mismatchedEvidence.redEvidence.results[0];
    if (!evidence) throw new Error("Expected evidence fixture.");
    evidence.command = "bun run test -- tests/unit/other.test.ts";
    evidence.expectedAssertion = "different assertion";
    evidence.acceptanceCriterionIds = ["ac-1"];
    expect(testWritingAgentOutputSchema.safeParse(mismatchedEvidence).success).toBe(false);

    const mismatchedPatch = validOutput();
    const test = mismatchedPatch.testPlan.tests[0];
    const patchEvidence = mismatchedPatch.redEvidence.results[0];
    if (!test || !patchEvidence) throw new Error("Expected test and evidence fixture.");
    test.path = "tests/unit/other.test.ts";
    test.command = "bun run test -- tests/unit/other.test.ts";
    patchEvidence.command = "bun run test -- tests/unit/other.test.ts";
    mismatchedPatch.redEvidence.testPlanSha256 = computeTestPlanDigest(mismatchedPatch.testPlan);
    expect(testWritingAgentOutputSchema.safeParse(mismatchedPatch).success).toBe(false);
  });

  it("rejects secret-like fixture data and production paths hidden in patch headers", () => {
    const unsafe = validOutput();
    (
      unsafe.testPlan.fixtures[0] as { data: Record<string, string | number | boolean | null> }
    ).data = {
      API_TOKEN: "super-secret-token",
    };
    unsafe.testPlan.patch.content = unsafe.testPlan.patch.content.replaceAll(
      "tests/unit/example.test.ts",
      "src/lib/runtime.ts",
    );
    unsafe.testPlan.patch.sha256 = sha256(unsafe.testPlan.patch.content);
    unsafe.testPlan.patch.byteCount = Buffer.byteLength(unsafe.testPlan.patch.content);

    const parsed = testWritingAgentOutputSchema.safeParse(unsafe);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("secret-like fixture data"),
          expect.stringContaining("undeclared or unsafe path"),
        ]),
      );
    }
  });

  it("rejects symlink, rename, binary, and pathless patch payloads", () => {
    for (const dangerousLine of [
      "new file mode 120000",
      "rename from tests/unit/example.test.ts",
      "GIT binary patch",
    ]) {
      const unsafe = validOutput();
      unsafe.testPlan.patch.content = `${unsafe.testPlan.patch.content}\n${dangerousLine}`;
      unsafe.testPlan.patch.sha256 = sha256(unsafe.testPlan.patch.content);
      unsafe.testPlan.patch.byteCount = Buffer.byteLength(unsafe.testPlan.patch.content);
      unsafe.redEvidence.testPlanSha256 = computeTestPlanDigest(unsafe.testPlan);
      expect(testWritingAgentOutputSchema.safeParse(unsafe).success).toBe(false);
    }

    const pathless = validOutput();
    pathless.testPlan.patch.content = "+expect(false).toBe(true);";
    pathless.testPlan.patch.sha256 = sha256(pathless.testPlan.patch.content);
    pathless.testPlan.patch.byteCount = Buffer.byteLength(pathless.testPlan.patch.content);
    pathless.redEvidence.testPlanSha256 = computeTestPlanDigest(pathless.testPlan);
    expect(testWritingAgentOutputSchema.safeParse(pathless).success).toBe(false);
  });
});

describe("Test-writing write and command allowlists", () => {
  it("allows focused test artifacts and rejects source, traversal, and shell mutation", () => {
    expect(isAllowedTestArtifactPath("tests/unit/example.test.ts")).toBe(true);
    expect(isAllowedTestArtifactPath("src/components/button.stories.tsx")).toBe(true);
    expect(isAllowedTestArtifactPath("src/lib/runtime.ts")).toBe(false);
    expect(isAllowedTestArtifactPath("../tests/escape.test.ts")).toBe(false);
    expect(isAllowedTestArtifactPath("tests/$(touch PWNED)/escape.test.ts")).toBe(false);
    expect(isAllowedTestArtifactPath("tests/`touch PWNED`/escape.test.ts")).toBe(false);

    expect(isAllowedFocusedTestCommand("bun run test -- tests/unit/example.test.ts")).toBe(true);
    expect(isAllowedFocusedTestCommand("bunx playwright test tests/e2e/example.spec.ts")).toBe(
      true,
    );
    expect(isAllowedFocusedTestCommand("bun run validate")).toBe(false);
    expect(
      isAllowedFocusedTestCommand("bun run test -- tests/unit/example.test.ts && git status"),
    ).toBe(false);
  });
});
