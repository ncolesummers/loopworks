import { createHash } from "node:crypto";

import { createPlanningAgentSeedPlan } from "./planning-agent";
import {
  computeTestPlanDigest,
  redTestEvidenceSchemaId,
  testPlanSchemaId,
} from "./test-writing-agent";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function createImplementationFixtureHandoff() {
  const plan = createPlanningAgentSeedPlan({
    body: [
      "## Acceptance Criteria",
      "- The exact hashed test patch turns green with a scoped production patch.",
      "- Test-writing fixtures and seed data are reused unchanged.",
      "- Future model, prompt, and tool changes have eval coverage.",
    ].join("\n"),
    issueNumber: 48,
    labels: ["area:agents"],
    milestone: null,
    repositoryFullName: "ncolesummers/loopworks",
    repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
    title: "Implementation subagent for the development loop",
  });
  const testPatch = [
    "diff --git a/tests/unit/agent/implementation-fixture.test.ts b/tests/unit/agent/implementation-fixture.test.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tests/unit/agent/implementation-fixture.test.ts",
    "@@ -0,0 +1 @@",
    "+expect(implementationReady).toBe(true);",
  ].join("\n");
  const testPlan = {
    version: 1 as const,
    schemaId: testPlanSchemaId,
    plan: {
      id: plan.identity.id,
      sha256: plan.identity.sha256,
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha: plan.repositoryRevision?.commitSha ?? "a".repeat(40),
    },
    acceptanceCriteria: plan.issue.acceptanceCriteria.map((text, index) => ({
      id: `ac-${index + 1}`,
      text,
    })),
    tests: [
      {
        id: "test-implementation-green",
        acceptanceCriterionIds: ["ac-1", "ac-2", "ac-3"],
        type: "unit" as const,
        path: "tests/unit/agent/implementation-fixture.test.ts",
        command: "bun run test -- tests/unit/agent/implementation-fixture.test.ts",
        steps: ["Run the exact focused implementation fixture."],
        expectedFailure: {
          kind: "assertion" as const,
          message: "expected false to be true",
        },
        fixtureIds: ["approved-plan"],
      },
    ],
    fixtures: [
      {
        id: "approved-plan",
        kind: "fixture" as const,
        description: "Approved-plan fixture authored by the test-writing stage.",
        data: { approved: true },
      },
    ],
    patch: {
      format: "unified-diff" as const,
      content: testPatch,
      sha256: sha256(testPatch),
      byteCount: Buffer.byteLength(testPatch),
      paths: ["tests/unit/agent/implementation-fixture.test.ts"],
    },
  };
  const redEvidence = {
    version: 1 as const,
    schemaId: redTestEvidenceSchemaId,
    planId: plan.identity.id,
    planSha256: plan.identity.sha256,
    testPlanSha256: computeTestPlanDigest(testPlan),
    results: [
      {
        id: "red-implementation-green",
        testId: "test-implementation-green",
        acceptanceCriterionIds: ["ac-1", "ac-2", "ac-3"],
        command: "bun run test -- tests/unit/agent/implementation-fixture.test.ts",
        outcome: "expected_failure" as const,
        exitCode: 1,
        durationMs: 10,
        expectedAssertion: "expected false to be true",
        executionReceipt: "b".repeat(64),
        outputReference: {
          uri: "artifact://fixture/red.log",
          sha256: "c".repeat(64),
          byteCount: 10,
          redacted: true as const,
        },
      },
    ],
  };
  return { plan, redEvidence, testPlan };
}
