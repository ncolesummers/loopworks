import { createHash } from "node:crypto";
import {
  computeScreenshotEvidenceDigest,
  type ScreenshotEvidence,
  screenshotEvidenceSchemaId,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationReportV1 } from "@/lib/loops/validation-report";
import {
  computeImplementationDigest,
  type ImplementationResult,
  implementationAgentModelLabel,
  implementationResultSchemaId,
} from "./implementation-agent";
import { createPlanningAgentSeedPlan } from "./planning-agent";
import { computeTestPlanDigest, testPlanSchemaId } from "./test-writing-agent";
import { computeValidationReviewDigest } from "./validation-review-agent";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function createValidationReviewFixtureContext() {
  const plan = createPlanningAgentSeedPlan({
    body: "## Acceptance Criteria\n- Review cites deterministic results and relevant screenshots.",
    issueNumber: 49,
    labels: ["area:agents", "area:validation"],
    milestone: "M4",
    repositoryFullName: "ncolesummers/loopworks",
    repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
    title: "Validation review subagent for the code review stage",
  });
  const revision = plan.repositoryRevision;
  if (!revision) throw new Error("Validation-review fixture requires a pinned revision.");
  const testPatch = [
    "diff --git a/tests/e2e/review.spec.ts b/tests/e2e/review.spec.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tests/e2e/review.spec.ts",
    "@@ -0,0 +1 @@",
    "+test('review evidence', async () => {});",
  ].join("\n");
  const testPlan = {
    version: 1 as const,
    schemaId: testPlanSchemaId as typeof testPlanSchemaId,
    plan: {
      id: plan.identity.id,
      sha256: plan.identity.sha256,
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha: revision.commitSha,
    },
    acceptanceCriteria: [
      { id: "ac-1", text: "Review cites deterministic results and relevant screenshots." },
    ],
    tests: [
      {
        id: "browser-ac-1",
        acceptanceCriterionIds: ["ac-1"],
        type: "browser" as const,
        path: "tests/e2e/review.spec.ts",
        command: "bunx playwright test tests/e2e/review.spec.ts",
        steps: ["Open the run detail and inspect the reviewed state."],
        expectedFailure: { kind: "assertion" as const, message: "review evidence is missing" },
        fixtureIds: [],
      },
    ],
    fixtures: [],
    patch: {
      format: "unified-diff" as const,
      content: testPatch,
      sha256: sha256(testPatch),
      byteCount: Buffer.byteLength(testPatch),
      paths: ["tests/e2e/review.spec.ts"],
    },
  };
  const productionPatch = [
    "diff --git a/src/components/review-card.tsx b/src/components/review-card.tsx",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/components/review-card.tsx",
    "@@ -0,0 +1 @@",
    "+export const ReviewCard = () => null;",
  ].join("\n");
  const implementationResult: ImplementationResult = {
    version: 1,
    schemaId: implementationResultSchemaId,
    model: implementationAgentModelLabel,
    binding: {
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      testPatchSha256: testPlan.patch.sha256,
      fixturesSha256: computeImplementationDigest(testPlan.fixtures),
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha: revision.commitSha,
    },
    patch: {
      format: "unified-diff",
      content: productionPatch,
      sha256: sha256(productionPatch),
      byteCount: Buffer.byteLength(productionPatch),
      paths: ["src/components/review-card.tsx"],
    },
    greenEvidence: [
      {
        id: "green-ac-1",
        testId: "browser-ac-1",
        acceptanceCriterionIds: ["ac-1"],
        command: "bunx playwright test tests/e2e/review.spec.ts",
        testPath: "tests/e2e/review.spec.ts",
        outcome: "pass",
        exitCode: 0,
        durationMs: 10,
        executionReceipt: "b".repeat(64),
        outputReference: {
          uri: "artifact://green.log",
          sha256: "c".repeat(64),
          byteCount: 10,
          redacted: true,
        },
      },
    ],
    validationEvidence: {
      command: "bun run validate",
      outcome: "pass",
      exitCode: 0,
      durationMs: 20,
      executionReceipt: "d".repeat(64),
      outputReference: {
        uri: "artifact://validate.log",
        sha256: "e".repeat(64),
        byteCount: 10,
        redacted: true,
      },
    },
  };
  const validationReport: ValidationReportV1 = {
    version: 1,
    schemaId: "loopworks.validation_report.v1",
    generatedAt: "2026-07-13T20:00:00.000Z",
    overallOutcome: "pass",
    counts: { failed: 0, passed: 1, skipped: 0, total: 1 },
    results: [
      {
        key: "aggregate-validation",
        name: "Aggregate validation",
        command: "bun run validate",
        durationMs: 20,
        exitCode: 0,
        outcome: "pass",
        phase: "before_review",
        produces: "validation_report",
        required: true,
        output: {
          uri: "artifact://validation.log",
          sha256: "f".repeat(64),
          stdoutBytes: 10,
          stderrBytes: 0,
          truncated: false,
        },
      },
    ],
  };
  const screenshotEvidence: ScreenshotEvidence = {
    version: 1,
    schemaId: screenshotEvidenceSchemaId,
    binding: {
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha: revision.commitSha,
      testPlanSha256: computeTestPlanDigest(testPlan),
      productionPatchSha256: implementationResult.patch.sha256,
    },
    uiAffecting: true,
    browserTestIds: ["browser-ac-1"],
    captures: (
      [
        ["mobile", 390, 844],
        ["laptop", 1280, 832],
        ["desktop", 1440, 960],
      ] as const
    ).map(([viewport, width, height], index) => ({
      id: `browser-ac-1-${viewport}`,
      testId: "browser-ac-1",
      viewport,
      width,
      height,
      mimeType: "image/png" as const,
      uri: `artifact://screenshots/${viewport}.png`,
      sha256: String(index + 1).repeat(64),
      byteCount: 100,
    })),
  };

  return {
    run: {
      id: "00000000-0000-4000-8000-000000000049",
      currentStage: "code-review",
      status: "running",
    },
    validationStep: {
      id: "00000000-0000-4000-8000-000000000149",
      status: "succeeded",
    },
    reviewStep: {
      id: "00000000-0000-4000-8000-000000000249",
      status: "running",
      attempt: 1,
    },
    planStatus: "approved",
    approvalStatus: "approved",
    plan,
    testPlan,
    implementationResult,
    validationReport,
    screenshotEvidence,
    testPlanArtifactSha256: computeTestPlanDigest(testPlan),
    implementationArtifactSha256: computeImplementationDigest(implementationResult),
    validationArtifactSha256: computeValidationReviewDigest(validationReport),
    screenshotArtifactSha256: computeScreenshotEvidenceDigest(screenshotEvidence),
  };
}
