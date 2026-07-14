/** @vitest-environment node */
import { createHash } from "node:crypto";

import {
  computeImplementationDigest,
  type ImplementationResult,
  implementationAgentModelLabel,
  implementationResultSchemaId,
} from "@agent/implementation-agent";
import {
  computeTestPlanDigest,
  redTestEvidenceSchemaId,
  testPlanSchemaId,
} from "@agent/test-writing-agent";
import {
  computeValidationReviewDigest,
  type ValidationReviewResult,
  validationReviewAgentModelLabel,
  validationReviewResultSchemaId,
} from "@agent/validation-review-agent";
import { and, eq, inArray } from "drizzle-orm";

import { agentPlans, approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  applyDevelopmentLoopValidationReport,
  applyDevelopmentLoopValidationReviewResult,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import {
  computeScreenshotEvidenceDigest,
  type ScreenshotEvidence,
  screenshotEvidenceSchemaId,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationReportV1 } from "@/lib/loops/validation-report";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("validation review transition", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      githubRepoId: 49_000_002,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
      enabledLoops: ["Agent-ready development loop"],
      validationGates: ["Aggregate validation"],
    });
  });

  afterEach(async () => context.close());

  async function prepare() {
    const created = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      now: () => new Date("2026-07-13T19:00:00.000Z"),
      trigger: {
        body: "## Acceptance Criteria\n- Review cites validation and responsive evidence.",
        issueNumber: 49,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Validation review subagent",
      },
    });
    if (created.mode !== "created") throw new Error("Expected created run.");
    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, created.runId));
    if (!approval) throw new Error("Expected plan approval.");
    await applyApprovalTransition({
      action: "approve",
      actorId: "maintainer",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });
    const [planRow] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, created.runId));
    const plan = planRow?.plan as { identity?: { id?: string; sha256?: string } };
    if (!planRow || !plan.identity?.id || !plan.identity.sha256) {
      throw new Error("Expected approved plan identity.");
    }

    const testPatch = [
      "diff --git a/tests/e2e/review.spec.ts b/tests/e2e/review.spec.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tests/e2e/review.spec.ts",
      "@@ -0,0 +1 @@",
      "+test('responsive review', async () => {});",
    ].join("\n");
    const testPlan = {
      version: 1 as const,
      schemaId: testPlanSchemaId,
      plan: {
        id: plan.identity.id,
        sha256: plan.identity.sha256,
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
      },
      acceptanceCriteria: [
        { id: "ac-1", text: "Review cites validation and responsive evidence." },
      ],
      tests: [
        {
          id: "browser-ac-1",
          acceptanceCriterionIds: ["ac-1"],
          type: "browser" as const,
          path: "tests/e2e/review.spec.ts",
          command: "bunx playwright test tests/e2e/review.spec.ts",
          steps: ["Open the run detail and inspect the responsive state."],
          expectedFailure: { kind: "assertion" as const, message: "responsive state is missing" },
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
    const redEvidence = {
      version: 1 as const,
      schemaId: redTestEvidenceSchemaId,
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      results: [
        {
          id: "red-ac-1",
          testId: "browser-ac-1",
          acceptanceCriterionIds: ["ac-1"],
          command: "bunx playwright test tests/e2e/review.spec.ts",
          outcome: "expected_failure" as const,
          exitCode: 1,
          durationMs: 10,
          expectedAssertion: "responsive state is missing",
          executionReceipt: "b".repeat(64),
          outputReference: {
            uri: "artifact://red.log",
            sha256: "c".repeat(64),
            byteCount: 10,
            redacted: true as const,
          },
        },
      ],
    };
    const productionPatch = [
      "diff --git a/src/components/review-card.tsx b/src/components/review-card.tsx",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/components/review-card.tsx",
      "@@ -0,0 +1 @@",
      "+export const ReviewCard = () => null;",
    ].join("\n");
    const implementation: ImplementationResult = {
      version: 1,
      schemaId: implementationResultSchemaId,
      model: implementationAgentModelLabel,
      binding: {
        planId: plan.identity.id,
        planSha256: plan.identity.sha256,
        testPlanSha256: computeTestPlanDigest(testPlan),
        testPatchSha256: testPlan.patch.sha256,
        fixturesSha256: computeImplementationDigest(testPlan.fixtures),
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
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
          executionReceipt: "d".repeat(64),
          outputReference: {
            uri: "artifact://green.log",
            sha256: "e".repeat(64),
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
        executionReceipt: "f".repeat(64),
        outputReference: {
          uri: "artifact://validate.log",
          sha256: "1".repeat(64),
          byteCount: 10,
          redacted: true,
        },
      },
    };
    const report: ValidationReportV1 = {
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
            sha256: "2".repeat(64),
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
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
        testPlanSha256: computeTestPlanDigest(testPlan),
        productionPatchSha256: implementation.patch.sha256,
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
        sha256: String(index + 3).repeat(64),
        byteCount: 100,
      })),
    };

    const steps = await context.db.select().from(runSteps).where(eq(runSteps.runId, created.runId));
    const step = (stage: string) => {
      const value = steps.find((candidate) => candidate.stage === stage);
      if (!value) throw new Error(`Expected ${stage} step.`);
      return value;
    };
    const testArtifacts = await context.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.stepId, step("test-writing").id));
    const patchArtifact = (
      await context.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.stepId, step("development").id))
    ).find(({ type }) => type === "patch");
    const validationArtifacts = await context.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.stepId, step("validation").id));
    const reviewArtifact = (
      await context.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.stepId, step("code-review").id))
    ).find(({ type }) => type === "log_summary");
    const testPlanArtifact = testArtifacts.find(({ type }) => type === "test_plan");
    const redArtifact = testArtifacts.find(({ type }) => type === "validation_report");
    const validationArtifact = validationArtifacts.find(({ type }) => type === "validation_report");
    let screenshotArtifact = validationArtifacts.find(({ type }) => type === "screenshot");
    if (!screenshotArtifact) {
      [screenshotArtifact] = await context.db
        .insert(artifacts)
        .values({
          runId: created.runId,
          stepId: step("validation").id,
          type: "screenshot",
          title: "Validation screenshots",
          uri: "artifact://validation/screenshots",
        })
        .returning();
    }
    if (
      !testPlanArtifact ||
      !redArtifact ||
      !patchArtifact ||
      !validationArtifact ||
      !screenshotArtifact ||
      !reviewArtifact
    ) {
      throw new Error("Expected stage artifacts.");
    }
    await context.db
      .update(artifacts)
      .set({
        metadata: { testPlan, testPlanMetadataKind: "test_plan_result" },
        sha256: computeTestPlanDigest(testPlan),
      })
      .where(eq(artifacts.id, testPlanArtifact.id));
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          redTestEvidence: redEvidence,
          redTestEvidenceMetadataKind: "red_test_evidence_result",
        },
        sha256: computeTestPlanDigest(redEvidence),
      })
      .where(eq(artifacts.id, redArtifact.id));
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          implementationMetadataKind: "implementation_result",
          implementationResult: implementation,
          implementationResultSchemaId,
          implementationVersion: 1,
        },
        sha256: computeImplementationDigest(implementation),
      })
      .where(eq(artifacts.id, patchArtifact.id));
    const validationReportSha256 = computeValidationReviewDigest(report);
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          detail: "Validation report: 1 passed, 0 failed, 0 skipped.",
          validationReport: report,
          validationReportMetadataKind: "validation_report_result",
          validationReportSchemaId: report.schemaId,
          validationReportVersion: 1,
        },
        sha256: validationReportSha256,
      })
      .where(eq(artifacts.id, validationArtifact.id));
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          screenshotEvidence,
          screenshotEvidenceMetadataKind: "screenshot_evidence_result",
          screenshotEvidenceSchemaId,
          screenshotEvidenceVersion: 1,
        },
        sha256: computeScreenshotEvidenceDigest(screenshotEvidence),
      })
      .where(eq(artifacts.id, screenshotArtifact.id));
    await context.db
      .update(runSteps)
      .set({ status: "succeeded", completedAt: new Date(), validationStatus: "red" })
      .where(eq(runSteps.id, step("test-writing").id));
    await context.db
      .update(runSteps)
      .set({
        status: "succeeded",
        completedAt: new Date(),
        validationStatus: "green",
        metadata: { implementationClaim: "claimed" },
      })
      .where(eq(runSteps.id, step("development").id));
    await context.db
      .update(runSteps)
      .set({ status: "succeeded", completedAt: new Date(), validationStatus: "passed" })
      .where(eq(runSteps.id, step("validation").id));
    await context.db
      .update(runSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(runSteps.id, step("code-review").id));
    await context.db
      .update(loopRuns)
      .set({ currentStage: "code-review", status: "running" })
      .where(eq(loopRuns.id, created.runId));

    const binding = {
      runId: created.runId,
      reviewAttempt: 1,
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      implementationResultSha256: computeImplementationDigest(implementation),
      productionPatchSha256: implementation.patch.sha256,
      validationReportSha256,
      screenshotEvidenceSha256: computeScreenshotEvidenceDigest(screenshotEvidence),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
    };
    const evidence = {
      validationResults: [
        {
          key: "aggregate-validation",
          command: "bun run validate",
          outcome: "pass" as const,
          outputSha256: "2".repeat(64),
        },
      ],
      screenshots: screenshotEvidence.captures.map(
        ({ id, testId, viewport, width, height, uri, sha256 }) => ({
          id,
          testId,
          viewport,
          width,
          height,
          uri,
          sha256,
        }),
      ),
    };
    const result = (route: "commit" | "development" | "test-writing"): ValidationReviewResult => ({
      version: 1,
      schemaId: validationReviewResultSchemaId,
      model: validationReviewAgentModelLabel,
      binding,
      evidence,
      findings:
        route === "commit"
          ? []
          : [
              {
                id: "finding-1",
                severity: route === "test-writing" ? "high" : "medium",
                category: route === "test-writing" ? "test-plan" : "implementation",
                summary:
                  route === "test-writing"
                    ? "The browser journey does not cover the required state."
                    : "The implementation does not satisfy the reviewed state.",
                path:
                  route === "test-writing"
                    ? "tests/e2e/review.spec.ts"
                    : "src/components/review-card.tsx",
                validationCitationKeys: ["aggregate-validation"],
                screenshotCitationIds: ["browser-ac-1-mobile"],
              },
            ],
      recommendation: {
        route,
        reason:
          route === "commit"
            ? "All bound validation and screenshot evidence supports forward routing."
            : "The cited finding requires another bounded stage attempt.",
        findingIds: route === "commit" ? [] : ["finding-1"],
        validationCitationKeys: ["aggregate-validation"],
        screenshotCitationIds: screenshotEvidence.captures.map(({ id }) => id),
      },
    });

    return {
      report,
      runId: created.runId,
      result,
      reviewArtifactId: reviewArtifact.id,
      screenshotArtifactId: screenshotArtifact.id,
    };
  }

  it("blocks UI-affecting validation before review when screenshots are absent", async () => {
    const prepared = await prepare();
    await context.db
      .update(artifacts)
      .set({ sha256: null })
      .where(eq(artifacts.id, prepared.screenshotArtifactId));
    await context.db
      .update(runSteps)
      .set({ completedAt: null, status: "queued", validationStatus: "required" })
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "validation")));
    await context.db
      .update(loopRuns)
      .set({ currentStage: "validation", status: "running" })
      .where(eq(loopRuns.id, prepared.runId));

    await expect(
      applyDevelopmentLoopValidationReport({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        report: prepared.report,
        runId: prepared.runId,
      }),
    ).resolves.toMatchObject({
      blockedReason: "UI-affecting validation requires complete screenshot evidence.",
      status: "blocked",
    });
  });

  it("persists forward review evidence and advances to commit", async () => {
    const prepared = await prepare();
    const logger = { info: vi.fn() };

    const result = await applyDevelopmentLoopValidationReviewResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      logger: logger as never,
      output: prepared.result("commit"),
      runId: prepared.runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, prepared.runId));
    const [reviewStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "code-review")));
    const [reviewArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, prepared.reviewArtifactId));
    expect(result).toMatchObject({ stage: "code-review", status: "advanced", route: "commit" });
    expect(run).toMatchObject({ currentStage: "commit", status: "running" });
    expect(reviewStep).toMatchObject({ status: "succeeded" });
    expect(reviewArtifact?.metadata).toMatchObject({
      validationReviewMetadataKind: "validation_review_result",
      validationReviewResult: prepared.result("commit"),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ route: "commit", findingCount: 0, screenshotCount: 3 }),
      "validation_review_stage_routed",
    );
  });

  it.each([
    ["development" as const, ["development", "validation", "code-review"]],
    ["test-writing" as const, ["test-writing", "development", "validation", "code-review"]],
  ])("atomically rewinds to %s and clears invalidated claims and artifacts", async (route, resetStages) => {
    const prepared = await prepare();
    await applyDevelopmentLoopValidationReviewResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      output: prepared.result(route),
      runId: prepared.runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, prepared.runId));
    const steps = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), inArray(runSteps.stage, resetStages)));
    expect(run).toMatchObject({ currentStage: route, status: "queued" });
    expect(run?.metadata).toMatchObject({
      validationReviewHistory: [
        expect.objectContaining({
          attempt: 1,
          route,
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });
    expect(JSON.stringify(run?.metadata)).not.toContain("bounded stage attempt");
    for (const step of steps) {
      expect(step).toMatchObject({
        attempt: 2,
        status: "queued",
        startedAt: null,
        completedAt: null,
      });
      expect(step.metadata).not.toHaveProperty("implementationClaim");
      expect(step.metadata).not.toHaveProperty("testWritingClaim");
      expect(step.metadata).not.toHaveProperty("validationReviewClaim");
    }
    const resetArtifacts = await context.db
      .select()
      .from(artifacts)
      .where(
        inArray(
          artifacts.stepId,
          steps.map(({ id }) => id),
        ),
      );
    expect(resetArtifacts.every(({ sha256 }) => sha256 === null)).toBe(true);
    if (route === "development") {
      const [testStep] = await context.db
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "test-writing")));
      expect(testStep).toMatchObject({ attempt: 1, status: "succeeded" });
    }
  });

  it("accepts exact replay idempotently and rejects conflicting replay", async () => {
    const prepared = await prepare();
    const output = prepared.result("development");
    await applyDevelopmentLoopValidationReviewResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      output,
      runId: prepared.runId,
    });
    await expect(
      applyDevelopmentLoopValidationReviewResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output,
        runId: prepared.runId,
      }),
    ).resolves.toMatchObject({ idempotent: true, route: "development" });

    const conflicting = structuredClone(output);
    conflicting.recommendation.reason = "A different reason must not replace the applied review.";
    await expect(
      applyDevelopmentLoopValidationReviewResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: conflicting,
        runId: prepared.runId,
      }),
    ).rejects.toThrow("does not match");
  });

  it("serializes concurrent application and leaves one auditable result", async () => {
    const prepared = await prepare();
    const output = prepared.result("commit");
    const applications = await Promise.allSettled(
      [1, 2].map(() =>
        applyDevelopmentLoopValidationReviewResult({
          database: context.db as unknown as DevelopmentLoopTransitionDatabase,
          output,
          runId: prepared.runId,
        }),
      ),
    );
    expect(applications.some(({ status }) => status === "fulfilled")).toBe(true);
    await expect(
      applyDevelopmentLoopValidationReviewResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output,
        runId: prepared.runId,
      }),
    ).resolves.toMatchObject({ idempotent: true, route: "commit" });
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, prepared.runId));
    expect((run?.metadata?.validationReviewHistory as unknown[] | undefined) ?? []).toHaveLength(1);
  });

  it("rejects stale validation bindings before persisting review notes", async () => {
    const prepared = await prepare();
    const output = prepared.result("commit");
    output.binding.validationReportSha256 = "0".repeat(64);

    await expect(
      applyDevelopmentLoopValidationReviewResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output,
        runId: prepared.runId,
      }),
    ).rejects.toThrow("bound");
  });

  it("refuses a backward route after the manifest retry budget is exhausted", async () => {
    const prepared = await prepare();
    await context.db
      .update(runSteps)
      .set({ attempt: 2 })
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "code-review")));
    const output = prepared.result("development");
    output.binding.reviewAttempt = 2;

    await expect(
      applyDevelopmentLoopValidationReviewResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output,
        runId: prepared.runId,
      }),
    ).rejects.toThrow("retry budget");
  });
});
