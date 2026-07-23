import { randomUUID } from "node:crypto";
import {
  computeImplementationDigest,
  createImplementationArtifactContractMetadata,
  type ImplementationResult,
  implementationResultSchema,
} from "@agent/implementation-agent";
import {
  computePlanningArtifactDigest,
  pinnedPlanningAgentOutputSchema,
  planningAgentOutputSchema,
} from "@agent/planning-agent";
import {
  computePrPreparationDigest,
  type PrPreparationResult,
  prPreparationResultSchema,
} from "@agent/pr-preparation-agent";
import {
  createPrPreparationResultFromContext,
  loadPrPreparationContextWithDatabase,
  type PrPreparationReadDatabase,
} from "@agent/subagents/pr-preparer/lib/context";
import { verifyImplementationExecutionReceipt } from "@agent/subagents/implementer/lib/tool-policy";
import { verifyTestExecutionReceipt } from "@agent/subagents/test-writer/lib/tool-policy";
import {
  computeTestPlanDigest,
  createRedTestEvidenceArtifactContractMetadata,
  createTestPlanArtifactContractMetadata,
  redTestEvidenceSchema,
  type TestWritingAgentOutput,
  testPlanArtifactSchema,
  testWriterModelLabel,
  testWritingAgentOutputSchema,
} from "@agent/test-writing-agent";
import {
  computeValidationReviewDigest,
  createValidationReviewArtifactContractMetadata,
  type ValidationReviewResult,
  validationReviewResultSchema,
} from "@agent/validation-review-agent";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import {
  agentPlans,
  approvals,
  approvalTransitionEvents,
  artifacts,
  loopRuns,
  repositories,
  runSteps,
} from "@/db/schema";
import type {
  GitHubFileChange,
  GitHubPullRequestWriteResult,
  GitHubPullRequestWriter,
} from "@/lib/github/pull-request";
import { createGitHubPullRequest, createPullRequestChangeDigest } from "@/lib/github/pull-request";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createPrIntentArtifactMetadata } from "@/lib/loops/pr-intent";
import { assertCanonicalLoopworksRunUrl } from "@/lib/loops/run-url";
import {
  assertScreenshotEvidenceBinding,
  assertScreenshotEvidenceCoverage,
  classifyUiAffectingChange,
  computeScreenshotEvidenceDigest,
  createScreenshotEvidenceArtifactContractMetadata,
  createScreenshotEvidenceArtifactMetadata,
  type ScreenshotEvidence,
  screenshotBrowserTests,
  screenshotEvidenceSchema,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationGateResultV1, ValidationReportV1 } from "@/lib/loops/validation-report";
import {
  createValidationReportArtifactContractMetadata,
  createValidationReportArtifactMetadata,
  validationReportArtifactMetadataSchema,
  validationReportV1Schema,
} from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  type DevelopmentLoopRunCompletedMetricInput,
  type DevelopmentLoopRunDurationMetricInput,
  type DevelopmentLoopStepDurationMetricInput,
  type DevelopmentLoopStepRetryMetricInput,
  type DevelopmentLoopValidationDurationMetricInput,
  type DevelopmentLoopValidationOutcomeMetricInput,
  developmentLoopRunCompletedEventType,
  recordDevelopmentLoopRunCompletedObservability,
  recordDevelopmentLoopRunCompletedMetric,
  recordDevelopmentLoopRunDurationMetric,
  recordDevelopmentLoopStepDurationMetric,
  recordDevelopmentLoopStepRetryMetric,
  recordDevelopmentLoopValidationDurationMetric,
  recordDevelopmentLoopValidationOutcomeMetric,
} from "@/lib/observability/metrics";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";

export type DevelopmentLoopTransitionDatabase = Pick<typeof db, "transaction">;

export type TestWritingTransitionResult = {
  idempotent?: boolean;
  runId: string;
  stage: "test-writing";
  status: "advanced";
  stepId: string;
  traceId?: string;
};

export type ApplyDevelopmentLoopTestWritingResultInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  occurredAt?: Date;
  output: TestWritingAgentOutput;
  receiptSecret?: string;
  runId: string;
};

export type ImplementationTransitionResult = {
  idempotent?: boolean;
  runId: string;
  stage: "development";
  status: "advanced";
  stepId: string;
  traceId?: string;
};

export type ApplyDevelopmentLoopImplementationResultInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  occurredAt?: Date;
  output: ImplementationResult;
  receiptSecret?: string;
  runId: string;
};

export type RecordDevelopmentLoopPlanArtifactInput = {
  database: DevelopmentLoopTransitionDatabase;
  occurredAt?: Date;
  plan: unknown;
  runId: string;
};

export async function recordDevelopmentLoopPlanArtifact(
  input: RecordDevelopmentLoopPlanArtifactInput,
): Promise<{ approvalId: string; planId: string; runId: string; status: "waiting_for_approval" }> {
  const plan = pinnedPlanningAgentOutputSchema.parse(input.plan);
  if (!plan.repositoryRevision || computePlanningArtifactDigest(plan) !== plan.identity.sha256) {
    throw new DevelopmentLoopTransitionError(
      "Plan review requires a valid digest and pinned repository revision.",
    );
  }
  const occurredAt = input.occurredAt ?? new Date();

  return input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({
        currentStage: loopRuns.currentStage,
        id: loopRuns.id,
        queuedAt: loopRuns.queuedAt,
        repositoryFullName: repositories.fullName,
        startedAt: loopRuns.startedAt,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);
    if (run?.currentStage !== "planning") {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} is not available for planning.`);
    }
    if (plan.issue.repositoryFullName !== run.repositoryFullName) {
      throw new DevelopmentLoopTransitionError("Plan repository does not match the run.");
    }

    const [planRow] = await tx
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, input.runId))
      .limit(1);
    const [planningStep] = await tx
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "planning")))
      .limit(1);
    if (!planRow || !planningStep) {
      throw new DevelopmentLoopTransitionError("Run is missing its planning records.");
    }

    await tx
      .update(agentPlans)
      .set({ agentName: "planner", plan, status: "requested" })
      .where(eq(agentPlans.id, planRow.id));

    const [existingApproval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")))
      .limit(1);
    if (existingApproval && existingApproval.status !== "requested") {
      throw new DevelopmentLoopTransitionError(
        "A resolved plan review cannot be rebound to a new plan.",
      );
    }
    const approvalMetadata = {
      planId: planRow.id,
      planSha256: plan.identity.sha256,
    };
    const approvalId = existingApproval?.id ?? randomUUID();
    if (existingApproval) {
      await tx
        .update(approvals)
        .set({ metadata: approvalMetadata, requestedBy: "planner" })
        .where(eq(approvals.id, existingApproval.id));
    } else {
      await tx.insert(approvals).values({
        id: approvalId,
        metadata: approvalMetadata,
        requestedBy: "planner",
        runId: input.runId,
        scope: "plan-review",
        status: "requested",
      });
    }

    const [planArtifact] = await tx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, input.runId),
          eq(artifacts.stepId, planningStep.id),
          eq(artifacts.type, "plan"),
        ),
      )
      .limit(1);
    if (!planArtifact) throw new DevelopmentLoopTransitionError("Planning artifact is missing.");
    await tx
      .update(artifacts)
      .set({
        metadata: {
          plan,
          planId: plan.identity.id,
          planMetadataKind: "plan_result",
          planSha256: plan.identity.sha256,
        },
        sha256: plan.identity.sha256,
      })
      .where(eq(artifacts.id, planArtifact.id));
    await tx
      .update(runSteps)
      .set({
        completedAt: occurredAt,
        startedAt: planningStep.startedAt ?? occurredAt,
        status: "succeeded",
      })
      .where(eq(runSteps.id, planningStep.id));
    await tx
      .update(loopRuns)
      .set({ startedAt: run.startedAt ?? run.queuedAt, status: "waiting_for_approval" })
      .where(eq(loopRuns.id, input.runId));

    return { approvalId, planId: planRow.id, runId: input.runId, status: "waiting_for_approval" };
  });
}

export type DevelopmentLoopValidationTransitionStatus = "advanced" | "blocked";
export type DevelopmentLoopTerminalStatus = "succeeded" | "failed" | "canceled";
export type DevelopmentLoopTerminalReason =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "canceled_by_reconciliation";

export type DevelopmentLoopTransitionMetrics = {
  runCompleted?: (input: DevelopmentLoopRunCompletedMetricInput) => void;
  runDuration?: (input: DevelopmentLoopRunDurationMetricInput) => void;
  stepDuration?: (input: DevelopmentLoopStepDurationMetricInput) => void;
  stepRetry?: (input: DevelopmentLoopStepRetryMetricInput) => void;
  validationDuration?: (input: DevelopmentLoopValidationDurationMetricInput) => void;
  validationOutcome?: (input: DevelopmentLoopValidationOutcomeMetricInput) => void;
};

export type ExpectedValidationGate = {
  key: string;
  required: boolean;
};

type RunMetadata = Record<string, unknown>;

type ValidationTransitionMetricInputs = {
  stepDuration: DevelopmentLoopStepDurationMetricInput;
  validationDurations: DevelopmentLoopValidationDurationMetricInput[];
  validationOutcomes: DevelopmentLoopValidationOutcomeMetricInput[];
};

type ValidationTransitionResult = {
  blockedReason?: string;
  idempotent?: boolean;
  runId: string;
  stage: string;
  status: DevelopmentLoopValidationTransitionStatus;
  stepId: string;
  traceId?: string;
};

const prApprovalScope = "external-write-review";
const developmentLoopMaxAttempts =
  defaultLoopManifest.loops.find(({ key }) => key === "development-loop")?.retryPolicy
    .maxAttempts ?? 1;

type PrStageTransitionResult = {
  artifactId: string;
  blockedReason?: string;
  idempotent?: boolean;
  mode: "development" | "live";
  pullRequestUrl?: string;
  runId: string;
  stage: "pr";
  status: DevelopmentLoopValidationTransitionStatus;
  stepId: string;
  traceId?: string;
};

type PrStageTransitionBaseInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  now?: () => Date;
  occurredAt?: Date;
  runId: string;
  runUrl: string;
};

type DevelopmentPrStageInput = PrStageTransitionBaseInput & {
  mode: "development";
};

type LivePrStageInput = PrStageTransitionBaseInput & {
  actorId: string;
  changes: GitHubFileChange[];
  commitMessage: string;
  mode: "live";
  writer?: GitHubPullRequestWriter;
};

export class DevelopmentLoopTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentLoopTransitionError";
  }
}

export async function applyDevelopmentLoopTestWritingResult(
  input: ApplyDevelopmentLoopTestWritingResultInput,
): Promise<TestWritingTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const transitionStartedAt = Date.now();
  const output = testWritingAgentOutputSchema.parse(input.output);
  const span = startLoopworksSpan("loopworks.test_writing.transition", {
    attributes: {
      "loopworks.agent": "test-writer",
      "loopworks.run_id": input.runId,
      "loopworks.stage": "test-writing",
      "loopworks.test_count": output.testPlan.tests.length,
      "loopworks.acceptance_criterion_count": output.testPlan.acceptanceCriteria.length,
    },
  });

  try {
    const result = await input.database.transaction<TestWritingTransitionResult>(async (tx) => {
      const [run] = await tx.select().from(loopRuns).where(eq(loopRuns.id, input.runId)).limit(1);
      if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

      const [step] = await tx
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "test-writing")))
        .limit(1);
      if (!step) {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} does not have a test-writing step.`,
        );
      }
      if (step.status === "succeeded" && step.completedAt) {
        return {
          idempotent: true,
          runId: input.runId,
          stage: "test-writing",
          status: "advanced",
          stepId: step.id,
          ...((step.traceId ?? run.traceId)
            ? { traceId: step.traceId ?? run.traceId ?? undefined }
            : {}),
        } satisfies TestWritingTransitionResult;
      }
      if (run.currentStage !== "test-writing") {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} is at ${run.currentStage}, not test-writing.`,
        );
      }

      const planRows = await tx.select().from(agentPlans).where(eq(agentPlans.runId, input.runId));
      if (planRows.length !== 1) {
        throw new DevelopmentLoopTransitionError("Test writing requires exactly one current plan.");
      }
      const planRow = planRows[0];
      const parsedPlan = planningAgentOutputSchema.safeParse(planRow?.plan);
      if (!planRow || !parsedPlan.success || !parsedPlan.data.repositoryRevision) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires a pinned planning artifact.",
        );
      }
      const plan = parsedPlan.data;
      const repositoryRevision = plan.repositoryRevision;
      if (!repositoryRevision) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires a pinned repository revision.",
        );
      }
      if (
        plan.identity.sha256 !== computePlanningArtifactDigest(plan) ||
        plan.identity.id !== output.testPlan.plan.id ||
        plan.identity.sha256 !== output.testPlan.plan.sha256 ||
        plan.issue.repositoryFullName !== output.testPlan.plan.repositoryFullName ||
        repositoryRevision.commitSha !== output.testPlan.plan.commitSha
      ) {
        throw new DevelopmentLoopTransitionError(
          "Test-writing output does not match the persisted plan.",
        );
      }

      const planApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
      if (planApprovals.length !== 1) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires exactly one current plan-review approval.",
        );
      }
      const approval = planApprovals[0];
      const approvalMetadata = approval?.metadata;
      if (
        approval?.status !== "approved" ||
        approvalMetadata?.planId !== planRow.id ||
        approvalMetadata?.planSha256 !== plan.identity.sha256
      ) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires an approved plan-review bound to the exact plan.",
        );
      }

      const expectedCriteria = plan.issue.acceptanceCriteria.map((text, index) => ({
        id: `ac-${index + 1}`,
        text,
      }));
      if (JSON.stringify(output.testPlan.acceptanceCriteria) !== JSON.stringify(expectedCriteria)) {
        throw new DevelopmentLoopTransitionError(
          "Test plan acceptance criteria do not exactly match the approved plan.",
        );
      }

      const receiptSecret = input.receiptSecret ?? process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET;
      if (!receiptSecret) {
        throw new DevelopmentLoopTransitionError(
          "Test execution receipt verification is not configured.",
        );
      }
      for (const result of output.redEvidence.results) {
        const test = output.testPlan.tests.find(({ id }) => id === result.testId);
        if (
          !test ||
          !verifyTestExecutionReceipt(
            {
              command: result.command,
              exitCode: result.exitCode,
              expectedAssertions: [result.expectedAssertion],
              outcome: result.outcome,
              outputSha256: result.outputReference.sha256,
              patchSha256: output.testPlan.patch.sha256,
              planSha256: plan.identity.sha256,
              testPaths: [test.path],
            },
            result.executionReceipt,
            receiptSecret,
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            `Red evidence receipt is invalid for test ${result.testId}.`,
          );
        }
      }

      const claimId = randomUUID();
      const [claimedStep] = await tx
        .update(runSteps)
        .set({ metadata: { ...(step.metadata ?? {}), testWritingClaim: claimId } })
        .where(
          and(
            eq(runSteps.id, step.id),
            sql`not coalesce(${runSteps.metadata} ? 'testWritingClaim', false)`,
          ),
        )
        .returning({ id: runSteps.id });
      if (!claimedStep) {
        throw new DevelopmentLoopTransitionError(
          `Test-writing transition is already in progress for run ${input.runId}.`,
        );
      }

      const stageArtifacts = await tx
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.runId, input.runId), eq(artifacts.stepId, step.id)));
      const redArtifact = stageArtifacts.find((artifact) => artifact.type === "validation_report");
      const testPlanArtifact = stageArtifacts.find((artifact) => artifact.type === "test_plan");
      if (!redArtifact || !testPlanArtifact) {
        throw new DevelopmentLoopTransitionError(
          "Test-writing step requires validation_report and test_plan artifacts.",
        );
      }

      await tx
        .update(artifacts)
        .set({
          metadata: {
            redTestEvidence: output.redEvidence,
            redTestEvidenceMetadataKind: "red_test_evidence_result",
            redTestEvidenceSchemaId: output.redEvidence.schemaId,
            redTestEvidenceVersion: output.redEvidence.version,
          },
          sha256: computeTestPlanDigest(output.redEvidence),
        })
        .where(eq(artifacts.id, redArtifact.id));
      await tx
        .update(artifacts)
        .set({
          metadata: {
            testPlan: output.testPlan,
            testPlanMetadataKind: "test_plan_result",
            testPlanSchemaId: output.testPlan.schemaId,
            testPlanVersion: output.testPlan.version,
          },
          sha256: computeTestPlanDigest(output.testPlan),
        })
        .where(eq(artifacts.id, testPlanArtifact.id));

      const startedAt = step.startedAt ?? occurredAt;
      await tx
        .update(runSteps)
        .set({
          completedAt: occurredAt,
          startedAt,
          status: "succeeded",
          validationStatus: "red",
        })
        .where(eq(runSteps.id, step.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "development",
          startedAt: run.startedAt ?? run.queuedAt,
          status: "running",
        })
        .where(eq(loopRuns.id, input.runId));

      input.logger?.info(
        {
          acceptanceCriterionCount: output.testPlan.acceptanceCriteria.length,
          durationMs: Math.max(0, Date.now() - transitionStartedAt),
          outcome: "advanced",
          planSha256: plan.identity.sha256,
          runId: input.runId,
          stepId: step.id,
          testCount: output.testPlan.tests.length,
        },
        "test_writing_stage_advanced",
      );

      return {
        runId: input.runId,
        stage: "test-writing",
        status: "advanced",
        stepId: step.id,
        ...((step.traceId ?? run.traceId)
          ? { traceId: step.traceId ?? run.traceId ?? undefined }
          : {}),
      } satisfies TestWritingTransitionResult;
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.outcome": "advanced",
    });
    markLoopworksSpanOk(span);
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

export async function applyDevelopmentLoopImplementationResult(
  input: ApplyDevelopmentLoopImplementationResultInput,
): Promise<ImplementationTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const startedAt = Date.now();
  const output = implementationResultSchema.parse(input.output);
  const span = startLoopworksSpan("loopworks.implementation.transition", {
    attributes: {
      "loopworks.agent": "implementer",
      "loopworks.run_id": input.runId,
      "loopworks.stage": "development",
      "loopworks.test_count": output.greenEvidence.length,
    },
  });

  try {
    const result = await input.database.transaction<ImplementationTransitionResult>(async (tx) => {
      const [run] = await tx.select().from(loopRuns).where(eq(loopRuns.id, input.runId)).limit(1);
      if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

      const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
      const step = steps.find(({ stage }) => stage === "development");
      const testWritingStep = steps.find(({ stage }) => stage === "test-writing");
      if (!step || !testWritingStep) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires development and test-writing steps.",
        );
      }
      if (step.status === "succeeded" && step.completedAt) {
        const [persistedArtifact] = await tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.runId, input.runId),
              eq(artifacts.stepId, step.id),
              eq(artifacts.type, "patch"),
            ),
          );
        if (persistedArtifact?.sha256 !== computeImplementationDigest(output)) {
          throw new DevelopmentLoopTransitionError(
            "Idempotent implementation replay does not match the persisted result.",
          );
        }
        return {
          idempotent: true,
          runId: input.runId,
          stage: "development",
          status: "advanced",
          stepId: step.id,
          ...((step.traceId ?? run.traceId)
            ? { traceId: step.traceId ?? run.traceId ?? undefined }
            : {}),
        };
      }
      if (run.currentStage !== "development" || testWritingStep.status !== "succeeded") {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires completed test writing and the development stage.",
        );
      }

      const planRows = await tx.select().from(agentPlans).where(eq(agentPlans.runId, input.runId));
      if (planRows.length !== 1) {
        throw new DevelopmentLoopTransitionError("Implementation requires exactly one plan.");
      }
      const planRow = planRows[0];
      const plan = planningAgentOutputSchema.parse(planRow?.plan);
      const planApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
      const approval = planApprovals[0];
      if (
        planRow?.status !== "approved" ||
        planApprovals.length !== 1 ||
        approval?.status !== "approved" ||
        approval.metadata?.planId !== planRow.id ||
        approval.metadata?.planSha256 !== plan.identity.sha256 ||
        !plan.repositoryRevision ||
        computePlanningArtifactDigest(plan) !== plan.identity.sha256
      ) {
        throw new DevelopmentLoopTransitionError("Implementation plan identity is invalid.");
      }

      const upstreamArtifacts = await tx
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.runId, input.runId), eq(artifacts.stepId, testWritingStep.id)));
      const testPlanRows = upstreamArtifacts.filter(({ type }) => type === "test_plan");
      const redRows = upstreamArtifacts.filter(({ type }) => type === "validation_report");
      if (testPlanRows.length !== 1 || redRows.length !== 1) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires exactly one test plan and red-evidence artifact.",
        );
      }
      const testPlanRow = testPlanRows[0];
      const redRow = redRows[0];
      const testPlanParsed = testPlanArtifactSchema.safeParse(testPlanRow?.metadata?.testPlan);
      const redParsed = redTestEvidenceSchema.safeParse(redRow?.metadata?.redTestEvidence);
      if (!testPlanRow || !redRow || !testPlanParsed.success || !redParsed.success) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires valid persisted test-plan and red-evidence artifacts.",
        );
      }
      const testPlan = testPlanParsed.data;
      const redEvidence = redParsed.data;
      const compositeHandoff = testWritingAgentOutputSchema.safeParse({
        model: testWriterModelLabel,
        testPlan,
        redEvidence,
      });
      if (!compositeHandoff.success) {
        throw new DevelopmentLoopTransitionError(
          "Persisted red evidence does not match the persisted test plan.",
        );
      }
      const testPlanSha256 = computeTestPlanDigest(testPlan);
      if (
        testPlanRow.sha256 !== testPlanSha256 ||
        redRow.sha256 !== computeTestPlanDigest(redEvidence) ||
        redEvidence.testPlanSha256 !== testPlanSha256 ||
        redEvidence.planId !== plan.identity.id ||
        redEvidence.planSha256 !== plan.identity.sha256 ||
        testPlan.plan.id !== plan.identity.id ||
        testPlan.plan.sha256 !== plan.identity.sha256 ||
        testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
        testPlan.plan.commitSha !== plan.repositoryRevision.commitSha
      ) {
        throw new DevelopmentLoopTransitionError("Implementation input artifacts are stale.");
      }

      const expectedBinding = {
        planId: plan.identity.id,
        planSha256: plan.identity.sha256,
        testPlanSha256,
        testPatchSha256: testPlan.patch.sha256,
        fixturesSha256: computeImplementationDigest(testPlan.fixtures),
        repositoryFullName: plan.issue.repositoryFullName,
        commitSha: plan.repositoryRevision.commitSha,
      };
      if (JSON.stringify(output.binding) !== JSON.stringify(expectedBinding)) {
        throw new DevelopmentLoopTransitionError(
          "Implementation result is not bound to the persisted handoff.",
        );
      }
      if (output.greenEvidence.length !== testPlan.tests.length) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires one green result for every planned test.",
        );
      }

      const receiptSecret = input.receiptSecret ?? process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET;
      if (!receiptSecret) {
        throw new DevelopmentLoopTransitionError(
          "Implementation execution receipt verification is not configured.",
        );
      }
      for (const plannedTest of testPlan.tests) {
        const evidence = output.greenEvidence.find(({ testId }) => testId === plannedTest.id);
        if (
          !evidence ||
          evidence.command !== plannedTest.command ||
          evidence.testPath !== plannedTest.path ||
          JSON.stringify(evidence.acceptanceCriterionIds) !==
            JSON.stringify(plannedTest.acceptanceCriterionIds) ||
          !verifyImplementationExecutionReceipt(
            {
              kind: "focused",
              command: evidence.command,
              exitCode: evidence.exitCode,
              outcome: evidence.outcome,
              outputSha256: evidence.outputReference.sha256,
              planSha256: output.binding.planSha256,
              testPlanSha256: output.binding.testPlanSha256,
              testPatchSha256: output.binding.testPatchSha256,
              productionPatchSha256: output.patch.sha256,
              testPaths: [evidence.testPath],
            },
            evidence.executionReceipt,
            receiptSecret,
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            `Invalid green implementation evidence for ${plannedTest.id}.`,
          );
        }
      }
      const validation = output.validationEvidence;
      if (
        !verifyImplementationExecutionReceipt(
          {
            kind: "aggregate",
            command: validation.command,
            exitCode: validation.exitCode,
            outcome: validation.outcome,
            outputSha256: validation.outputReference.sha256,
            planSha256: output.binding.planSha256,
            testPlanSha256: output.binding.testPlanSha256,
            testPatchSha256: output.binding.testPatchSha256,
            productionPatchSha256: output.patch.sha256,
            testPaths: [],
          },
          validation.executionReceipt,
          receiptSecret,
        )
      ) {
        throw new DevelopmentLoopTransitionError("Aggregate validation receipt is invalid.");
      }

      const claimId = randomUUID();
      const [claimedStep] = await tx
        .update(runSteps)
        .set({ metadata: { ...(step.metadata ?? {}), implementationClaim: claimId } })
        .where(
          and(
            eq(runSteps.id, step.id),
            sql`not coalesce(${runSteps.metadata} ? 'implementationClaim', false)`,
          ),
        )
        .returning({ id: runSteps.id });
      if (!claimedStep) {
        throw new DevelopmentLoopTransitionError(
          `Implementation transition is already in progress for run ${input.runId}.`,
        );
      }

      const [patchArtifact] = await tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.runId, input.runId),
            eq(artifacts.stepId, step.id),
            eq(artifacts.type, "patch"),
          ),
        );
      if (!patchArtifact) {
        throw new DevelopmentLoopTransitionError("Development patch artifact is missing.");
      }
      await tx
        .update(artifacts)
        .set({
          metadata: {
            implementationMetadataKind: "implementation_result",
            implementationResult: output,
            implementationResultSchemaId: output.schemaId,
            implementationVersion: output.version,
          },
          sha256: computeImplementationDigest(output),
        })
        .where(eq(artifacts.id, patchArtifact.id));
      await tx
        .update(runSteps)
        .set({
          completedAt: occurredAt,
          startedAt: step.startedAt ?? occurredAt,
          status: "succeeded",
          validationStatus: "green",
        })
        .where(eq(runSteps.id, step.id));
      await tx
        .update(loopRuns)
        .set({ currentStage: "validation", status: "running" })
        .where(eq(loopRuns.id, input.runId));

      input.logger?.info(
        {
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: "advanced",
          patchSha256: output.patch.sha256,
          runId: input.runId,
          stepId: step.id,
          testCount: output.greenEvidence.length,
        },
        "implementation_stage_advanced",
      );

      return {
        runId: input.runId,
        stage: "development",
        status: "advanced",
        stepId: step.id,
        ...((step.traceId ?? run.traceId)
          ? { traceId: step.traceId ?? run.traceId ?? undefined }
          : {}),
      };
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - startedAt),
      "loopworks.outcome": "advanced",
    });
    markLoopworksSpanOk(span);
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

function durationSecondsBetween(startedAt: Date, completedAt: Date): number {
  return Math.max(0, (completedAt.getTime() - startedAt.getTime()) / 1000);
}

function sumValidationDurationMs(report: ValidationReportV1): number {
  return report.results.reduce((total, result) => total + Math.max(0, result.durationMs), 0);
}

function requiredSkippedResults(report: ValidationReportV1): ValidationGateResultV1[] {
  return report.results.filter((result) => result.required && result.outcome === "skipped");
}

function failedResults(report: ValidationReportV1): ValidationGateResultV1[] {
  return report.results.filter((result) => result.outcome === "fail");
}

function missingRequiredGateKeys(
  report: ValidationReportV1,
  expectedValidationGates: readonly ExpectedValidationGate[] | undefined,
): string[] {
  if (!expectedValidationGates) {
    return [];
  }

  const resultKeys = new Set(report.results.map((result) => result.key));
  return expectedValidationGates
    .filter((gate) => gate.required && !resultKeys.has(gate.key))
    .map((gate) => gate.key);
}

function getBlockedReason(
  report: ValidationReportV1,
  expectedValidationGates?: readonly ExpectedValidationGate[],
): string | undefined {
  if (report.results.length === 0) {
    return "Validation report contained no gate results.";
  }

  if (failedResults(report).length > 0) {
    return "Deterministic validation failed before review.";
  }

  if (requiredSkippedResults(report).length > 0) {
    return "Required validation gate skipped before review.";
  }

  if (missingRequiredGateKeys(report, expectedValidationGates).length > 0) {
    return "Required validation gate missing before review.";
  }

  return undefined;
}

function getStartedAtForDuration(input: {
  completedAt: Date;
  durationMs: number;
  startedAt: Date | null;
}): Date {
  if (input.startedAt) {
    return input.startedAt;
  }

  return new Date(input.completedAt.getTime() - Math.max(0, input.durationMs));
}

function metadataWithoutBlockedReason(metadata: RunMetadata | null | undefined): RunMetadata {
  const { blockedReason: _blockedReason, ...rest } = metadata ?? {};
  return rest;
}

function metadataWithoutPrFailure(metadata: RunMetadata | null | undefined): RunMetadata {
  const {
    failureCode: _failureCode,
    retryable: _retryable,
    prChangeDigest: _prChangeDigest,
    ...rest
  } = metadata ?? {};
  return rest;
}

function approvalMetadataWithoutClaim(metadata: RunMetadata | null | undefined): RunMetadata {
  const { prWriteClaim: _prWriteClaim, ...rest } = metadata ?? {};
  return rest;
}

function getPersistedBlockedReason(metadata: RunMetadata | null | undefined): string | undefined {
  const blockedReason = metadata?.blockedReason;
  return typeof blockedReason === "string" && blockedReason.length > 0 ? blockedReason : undefined;
}

const safeReasonCodePattern = /^[a-z][a-z0-9_.:-]{0,79}$/;

function normalizeReasonCode(reason: string | undefined): string | undefined {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return safeReasonCodePattern.test(normalized) ? normalized : "unspecified";
}

function createValidationTransitionMetadata(input: {
  metadata: RunMetadata | null | undefined;
  report: ValidationReportV1;
  blockedReason?: string;
}): RunMetadata {
  return {
    ...metadataWithoutBlockedReason(input.metadata),
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    validationCounts: input.report.counts,
    validationOutcome: input.blockedReason ? "blocked" : input.report.overallOutcome,
    validationReportSchemaId: input.report.schemaId,
  };
}

function createStepValidationMetadata(input: {
  metadata: RunMetadata | null | undefined;
  report: ValidationReportV1;
  requiredSkippedCount: number;
}): RunMetadata {
  return {
    ...(input.metadata ?? {}),
    validationCounts: input.report.counts,
    validationOutcome: input.report.overallOutcome,
    validationReportSchemaId: input.report.schemaId,
    validationRequiredSkippedGateCount: input.requiredSkippedCount,
  };
}

function createValidationMetricInputs(input: {
  loopKey: string;
  report: ValidationReportV1;
  stage: string;
  stepStatus: "succeeded" | "failed";
  stepDurationSeconds: number;
}): ValidationTransitionMetricInputs {
  const measurableResults = input.report.results.filter(
    (result): result is ValidationGateResultV1 & { outcome: "pass" | "fail" } =>
      result.outcome === "pass" || result.outcome === "fail",
  );

  return {
    stepDuration: {
      durationSeconds: input.stepDurationSeconds,
      loopKey: input.loopKey,
      stage: input.stage,
      status: input.stepStatus,
    },
    validationDurations: measurableResults.map((result) => ({
      command: result.command,
      durationSeconds: Math.max(0, result.durationMs) / 1000,
      gate: result.key,
    })),
    validationOutcomes: measurableResults.map((result) => ({
      command: result.command,
      gate: result.key,
      status: result.outcome,
    })),
  };
}

function emitSafely<T>(recorder: ((input: T) => void) | undefined, input: T): void {
  try {
    recorder?.(input);
  } catch {
    // Runtime state transitions must remain authoritative when telemetry sinks fail.
  }
}

function emitValidationTransitionMetrics(
  metrics: DevelopmentLoopTransitionMetrics | undefined,
  inputs: ValidationTransitionMetricInputs,
): void {
  const recordStepDuration = metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric;
  const recordValidationDuration =
    metrics?.validationDuration ?? recordDevelopmentLoopValidationDurationMetric;
  const recordValidationOutcome =
    metrics?.validationOutcome ?? recordDevelopmentLoopValidationOutcomeMetric;

  emitSafely(recordStepDuration, inputs.stepDuration);
  for (const input of inputs.validationOutcomes) {
    emitSafely(recordValidationOutcome, input);
  }
  for (const input of inputs.validationDurations) {
    emitSafely(recordValidationDuration, input);
  }
}

export async function applyDevelopmentLoopValidationReport(input: {
  database: DevelopmentLoopTransitionDatabase;
  expectedValidationGates?: readonly ExpectedValidationGate[];
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  report: ValidationReportV1;
  runId: string;
  screenshotEvidence?: ScreenshotEvidence;
}): Promise<ValidationTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const report = validationReportV1Schema.parse(input.report);
  let metricInputs: ValidationTransitionMetricInputs | undefined;

  const result = await input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({
        currentStage: loopRuns.currentStage,
        id: loopRuns.id,
        loopKey: loopRuns.loopKey,
        metadata: loopRuns.metadata,
        queuedAt: loopRuns.queuedAt,
        repository: repositories.fullName,
        startedAt: loopRuns.startedAt,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);

    if (!run) {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);
    }

    const [step] = await tx
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "validation")))
      .limit(1);

    if (!step) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have a validation step.`,
      );
    }
    const generatedAt = new Date(report.generatedAt);
    if (generatedAt < step.queuedAt || generatedAt > occurredAt) {
      throw new DevelopmentLoopTransitionError(
        "Validation report timestamp is stale or later than the transition time.",
      );
    }

    const validationArtifacts = await tx
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, input.runId), eq(artifacts.stepId, step.id)));
    const artifact = validationArtifacts.find(({ type }) => type === "validation_report");
    const screenshotArtifact = validationArtifacts.find(({ type }) => type === "screenshot");

    if (!artifact) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} validation step ${step.id} does not have a validation_report artifact.`,
      );
    }

    if (step.completedAt && (step.status === "succeeded" || step.status === "failed")) {
      const traceId = step.traceId ?? run.traceId ?? undefined;
      const persistedBlockedReason = getPersistedBlockedReason(run.metadata);
      return {
        ...(step.status === "failed"
          ? { blockedReason: persistedBlockedReason ?? "Validation transition already failed." }
          : {}),
        idempotent: true,
        runId: input.runId,
        stage: step.stage,
        status: step.status === "failed" ? "blocked" : "advanced",
        stepId: step.id,
        ...(traceId ? { traceId } : {}),
      } satisfies ValidationTransitionResult;
    }

    let screenshotEvidence = input.screenshotEvidence
      ? screenshotEvidenceSchema.parse(input.screenshotEvidence)
      : undefined;
    let uiAffecting: boolean | undefined;
    const runArtifacts = await tx.select().from(artifacts).where(eq(artifacts.runId, input.runId));
    const testPlanArtifact = runArtifacts.find(({ type }) => type === "test_plan");
    const implementationArtifact = runArtifacts.find(
      ({ type, metadata }) =>
        type === "patch" && metadata?.implementationMetadataKind === "implementation_result",
    );
    const testPlanParsed = testPlanArtifactSchema.safeParse(testPlanArtifact?.metadata?.testPlan);
    const implementationParsed = implementationResultSchema.safeParse(
      implementationArtifact?.metadata?.implementationResult,
    );
    if (testPlanParsed.success && implementationParsed.success) {
      const expectedScreenshotBinding = {
        repositoryFullName: implementationParsed.data.binding.repositoryFullName,
        commitSha: implementationParsed.data.binding.commitSha,
        testPlanSha256: computeTestPlanDigest(testPlanParsed.data),
        productionPatchSha256: implementationParsed.data.patch.sha256,
      };
      uiAffecting = classifyUiAffectingChange({
        productionPaths: implementationParsed.data.patch.paths,
        tests: testPlanParsed.data.tests,
      });
      if (screenshotEvidence) {
        assertScreenshotEvidenceBinding(screenshotEvidence, expectedScreenshotBinding);
        assertScreenshotEvidenceCoverage(screenshotEvidence, {
          uiAffecting,
          browserTestIds: screenshotBrowserTests(testPlanParsed.data.tests).map(({ id }) => id),
        });
      } else if (!uiAffecting) {
        screenshotEvidence = screenshotEvidenceSchema.parse({
          version: 1,
          schemaId: "loopworks.screenshot_evidence.v1",
          binding: expectedScreenshotBinding,
          uiAffecting: false,
          browserTestIds: [],
          captures: [],
        });
      }
    } else if (screenshotEvidence) {
      throw new DevelopmentLoopTransitionError(
        "Screenshot evidence requires persisted test-plan and implementation bindings.",
      );
    }
    const screenshotBlockedReason =
      uiAffecting === true && !screenshotEvidence
        ? "UI-affecting validation requires complete screenshot evidence."
        : uiAffecting !== undefined && !screenshotArtifact
          ? "Validation requires a screenshot evidence artifact."
          : undefined;
    const blockedReason =
      getBlockedReason(report, input.expectedValidationGates) ?? screenshotBlockedReason;
    const stepStatus = blockedReason ? "failed" : "succeeded";
    const stepDurationMs = sumValidationDurationMs(report);
    const stepStartedAt = getStartedAtForDuration({
      completedAt: occurredAt,
      durationMs: stepDurationMs,
      startedAt: step.startedAt,
    });
    const stepDurationSeconds = durationSecondsBetween(stepStartedAt, occurredAt);
    const traceId = step.traceId ?? run.traceId;
    const requiredSkippedCount = requiredSkippedResults(report).length;

    await tx
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(report),
        sha256: computeValidationReviewDigest(report),
      })
      .where(eq(artifacts.id, artifact.id));
    if (screenshotEvidence && screenshotArtifact) {
      await tx
        .update(artifacts)
        .set({
          metadata: createScreenshotEvidenceArtifactMetadata(screenshotEvidence),
          sha256: computeScreenshotEvidenceDigest(screenshotEvidence),
        })
        .where(eq(artifacts.id, screenshotArtifact.id));
    }

    await tx
      .update(runSteps)
      .set({
        completedAt: occurredAt,
        metadata: createStepValidationMetadata({
          metadata: step.metadata,
          report,
          requiredSkippedCount,
        }),
        startedAt: stepStartedAt,
        status: stepStatus,
        traceId,
        validationStatus: blockedReason ? "failed" : "passed",
      })
      .where(eq(runSteps.id, step.id));

    await tx
      .update(loopRuns)
      .set({
        currentStage: blockedReason ? "validation" : "code-review",
        metadata: createValidationTransitionMetadata({
          blockedReason,
          metadata: run.metadata,
          report,
        }),
        startedAt: run.startedAt ?? run.queuedAt,
        status: blockedReason ? "blocked" : "running",
      })
      .where(eq(loopRuns.id, input.runId));

    metricInputs = createValidationMetricInputs({
      loopKey: run.loopKey,
      report,
      stage: step.stage,
      stepDurationSeconds,
      stepStatus,
    });

    return {
      ...(blockedReason ? { blockedReason } : {}),
      runId: input.runId,
      stage: step.stage,
      status: blockedReason ? "blocked" : "advanced",
      stepId: step.id,
      ...(traceId ? { traceId } : {}),
    } satisfies ValidationTransitionResult;
  });

  if (metricInputs) {
    emitValidationTransitionMetrics(input.metrics, metricInputs);
  }

  input.logger?.info(
    {
      blockedReason: result.blockedReason,
      idempotent: "idempotent" in result ? result.idempotent : undefined,
      runId: result.runId,
      stage: result.stage,
      status: result.status,
      stepId: result.stepId,
      traceId: result.traceId,
    },
    "development_loop_validation_transition_persisted",
  );

  return result;
}

export type ValidationReviewTransitionResult = {
  idempotent?: boolean;
  route: "commit" | "development" | "test-writing";
  runId: string;
  stage: "code-review";
  status: "advanced" | "requeued";
  stepId: string;
  traceId?: string;
};

export type PrPreparationTransitionResult = {
  idempotent?: boolean;
  intentSha256: string;
  runId: string;
  stage: "pr";
  status: "prepared";
  stepId: string;
  traceId?: string;
};

export async function applyDevelopmentLoopPrPreparationResult(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  output: PrPreparationResult;
  runId: string;
  runUrl: string;
}): Promise<PrPreparationTransitionResult> {
  const output = prPreparationResultSchema.parse(input.output);
  const digest = computePrPreparationDigest(output);
  const transitionStartedAt = Date.now();
  const span = startLoopworksSpan("loopworks.pr_preparation.transition", {
    attributes: {
      "loopworks.agent": "pr-preparer",
      "loopworks.artifact_count": output.intent.artifacts.length,
      "loopworks.deployment_present": Boolean(output.intent.deployment),
      "loopworks.run_id": input.runId,
      "loopworks.screenshot_count": output.screenshots.length,
      "loopworks.stage": "pr",
    },
  });
  try {
    const result = await input.database.transaction<PrPreparationTransitionResult>(async (tx) => {
      const context = await loadPrPreparationContextWithDatabase(
        tx as unknown as PrPreparationReadDatabase,
        input.runId,
        input.runUrl,
      );
      const [prArtifact] = await tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.runId, input.runId),
            eq(artifacts.stepId, context.prStep.id),
            eq(artifacts.type, "pr_intent"),
          ),
        );
      if (!prArtifact) {
        throw new DevelopmentLoopTransitionError("PR preparation artifact is missing.");
      }
      const existingDigest = (prArtifact.metadata as { prPreparationResultSha256?: unknown } | null)
        ?.prPreparationResultSha256;
      if (typeof existingDigest === "string") {
        if (existingDigest !== digest) {
          throw new DevelopmentLoopTransitionError(
            "PR preparation replay has conflicting persisted intent.",
          );
        }
        return {
          idempotent: true,
          intentSha256: digest,
          runId: input.runId,
          stage: "pr",
          status: "prepared",
          stepId: context.prStep.id,
        };
      }
      const expected = createPrPreparationResultFromContext(context, output.narrative);
      if (computePrPreparationDigest(expected) !== digest) {
        throw new DevelopmentLoopTransitionError(
          "PR preparation result does not match the exact persisted handoff.",
        );
      }
      const matchingApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, prApprovalScope)));
      const approval = matchingApprovals.length === 1 ? matchingApprovals[0] : undefined;
      if (approval?.status !== "requested") {
        throw new DevelopmentLoopTransitionError(
          "PR preparation requires one requested external-write approval.",
        );
      }
      const [claimedArtifact] = await tx
        .update(artifacts)
        .set({
          metadata: {
            ...createPrIntentArtifactMetadata(output.intent),
            prPreparationResult: output,
            prPreparationResultSchemaId: output.schemaId,
            prPreparationResultSha256: digest,
          },
          sha256: digest,
        })
        .where(
          and(
            eq(artifacts.id, prArtifact.id),
            isNull(artifacts.sha256),
            sql`not coalesce(${artifacts.metadata} ? 'prPreparationResultSha256', false)`,
          ),
        )
        .returning({ id: artifacts.id });
      if (!claimedArtifact) {
        const [persistedArtifact] = await tx
          .select({ metadata: artifacts.metadata })
          .from(artifacts)
          .where(eq(artifacts.id, prArtifact.id))
          .limit(1);
        const persistedDigest = (
          persistedArtifact?.metadata as { prPreparationResultSha256?: unknown } | null
        )?.prPreparationResultSha256;
        if (persistedDigest === digest) {
          return {
            idempotent: true,
            intentSha256: digest,
            runId: input.runId,
            stage: "pr",
            status: "prepared",
            stepId: context.prStep.id,
          };
        }
        throw new DevelopmentLoopTransitionError(
          "PR preparation replay has conflicting persisted intent.",
        );
      }
      const [boundApproval] = await tx
        .update(approvals)
        .set({
          metadata: {
            ...(approval.metadata ?? {}),
            prIntentDigest: digest,
          },
        })
        .where(and(eq(approvals.id, approval.id), eq(approvals.status, "requested")))
        .returning({ id: approvals.id });
      if (!boundApproval) {
        throw new DevelopmentLoopTransitionError(
          "External-write approval changed before PR intent binding completed.",
        );
      }
      const [currentPrStep] = await tx
        .select({ metadata: runSteps.metadata })
        .from(runSteps)
        .where(eq(runSteps.id, context.prStep.id));
      await tx
        .update(runSteps)
        .set({
          metadata: {
            ...(currentPrStep?.metadata ?? {}),
            ...(context.prStep.status === "running" ? { preparationStarted: true } : {}),
            prPreparationResultSchemaId: output.schemaId,
            prPreparationResultSha256: digest,
          },
        })
        .where(eq(runSteps.id, context.prStep.id));
      return {
        intentSha256: digest,
        runId: input.runId,
        stage: "pr",
        status: "prepared",
        stepId: context.prStep.id,
      };
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.idempotent": result.idempotent ?? false,
      "loopworks.intent_sha256": digest,
      "loopworks.outcome": result.status,
    });
    markLoopworksSpanOk(span);
    input.logger?.info(
      {
        artifactCount: output.intent.artifacts.length,
        deploymentPresent: Boolean(output.intent.deployment),
        idempotent: result.idempotent ?? false,
        intentSha256: digest,
        model: output.model,
        runId: input.runId,
        screenshotCount: output.screenshots.length,
        stage: "pr",
        status: result.status,
        stepId: result.stepId,
      },
      "development_loop_pr_preparation_persisted",
    );
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

type ValidationReviewHistoryEntry = {
  attempt: number;
  digest: string;
  findingCount: number;
  occurredAt: string;
  reasonSha256: string;
  route: ValidationReviewTransitionResult["route"];
};

function validationReviewHistory(metadata: RunMetadata | null): ValidationReviewHistoryEntry[] {
  const value = metadata?.validationReviewHistory;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<ValidationReviewHistoryEntry>;
    return typeof candidate.attempt === "number" &&
      typeof candidate.digest === "string" &&
      typeof candidate.findingCount === "number" &&
      typeof candidate.occurredAt === "string" &&
      typeof candidate.reasonSha256 === "string" &&
      ["commit", "development", "test-writing"].includes(candidate.route ?? "")
      ? [candidate as ValidationReviewHistoryEntry]
      : [];
  });
}

function metadataWithoutExecutionClaims(metadata: RunMetadata | null): RunMetadata {
  const {
    implementationClaim: _implementationClaim,
    testWritingClaim: _testWritingClaim,
    validationReviewClaim: _validationReviewClaim,
    ...rest
  } = metadata ?? {};
  return rest;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return computeValidationReviewDigest(left) === computeValidationReviewDigest(right);
}

export async function applyDevelopmentLoopValidationReviewResult(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  output: ValidationReviewResult;
  runId: string;
}): Promise<ValidationReviewTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const transitionStartedAt = Date.now();
  const output = validationReviewResultSchema.parse(input.output);
  const digest = computeValidationReviewDigest(output);
  const span = startLoopworksSpan("loopworks.validation_review.transition", {
    attributes: {
      "loopworks.attempt": output.binding.reviewAttempt,
      "loopworks.finding_count": output.findings.length,
      "loopworks.route": output.recommendation.route,
      "loopworks.run_id": input.runId,
      "loopworks.screenshot_count": output.evidence.screenshots.length,
      "loopworks.stage": "code-review",
      "loopworks.validation_evidence_count": output.evidence.validationResults.length,
    },
  });
  let retryMetric: DevelopmentLoopStepRetryMetricInput | undefined;

  try {
    const result = await input.database.transaction<ValidationReviewTransitionResult>(
      async (tx) => {
        const [run] = await tx
          .select({
            currentStage: loopRuns.currentStage,
            id: loopRuns.id,
            loopKey: loopRuns.loopKey,
            metadata: loopRuns.metadata,
            repositoryFullName: repositories.fullName,
            status: loopRuns.status,
            traceId: loopRuns.traceId,
          })
          .from(loopRuns)
          .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
          .where(eq(loopRuns.id, input.runId))
          .limit(1);
        if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

        const priorHistory = validationReviewHistory(run.metadata);
        const priorAttempt = priorHistory.find(
          ({ attempt }) => attempt === output.binding.reviewAttempt,
        );
        if (priorAttempt) {
          if (
            priorAttempt.digest !== digest ||
            priorAttempt.route !== output.recommendation.route
          ) {
            throw new DevelopmentLoopTransitionError(
              "Validation review replay does not match the previously applied result.",
            );
          }
          const reviewStep = (
            await tx
              .select()
              .from(runSteps)
              .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "code-review")))
          )[0];
          if (!reviewStep) throw new DevelopmentLoopTransitionError("Code-review step is missing.");
          return {
            idempotent: true,
            route: priorAttempt.route,
            runId: input.runId,
            stage: "code-review",
            status: priorAttempt.route === "commit" ? "advanced" : "requeued",
            stepId: reviewStep.id,
            ...((reviewStep.traceId ?? run.traceId)
              ? { traceId: reviewStep.traceId ?? run.traceId ?? undefined }
              : {}),
          };
        }

        const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
        const stepByStage = new Map(steps.map((step) => [step.stage, step]));
        const validationStep = stepByStage.get("validation");
        const reviewStep = stepByStage.get("code-review");
        if (!validationStep || !reviewStep) {
          throw new DevelopmentLoopTransitionError(
            "Validation review requires validation and code-review steps.",
          );
        }
        if (
          run.currentStage !== "code-review" ||
          run.status !== "running" ||
          validationStep.status !== "succeeded" ||
          !["queued", "running"].includes(reviewStep.status)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review cannot run before completed passing validation.",
          );
        }
        if (
          output.binding.runId !== input.runId ||
          output.binding.reviewAttempt !== reviewStep.attempt
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review result is not bound to the active run attempt.",
          );
        }

        const planRows = await tx
          .select()
          .from(agentPlans)
          .where(eq(agentPlans.runId, input.runId));
        const planApprovals = await tx
          .select()
          .from(approvals)
          .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
        if (planRows.length !== 1 || planApprovals.length !== 1) {
          throw new DevelopmentLoopTransitionError(
            "Validation review requires exactly one approved plan.",
          );
        }
        const [planRow] = planRows;
        const [approval] = planApprovals;
        if (!planRow || !approval) {
          throw new DevelopmentLoopTransitionError(
            "Validation review plan context changed while it was being loaded.",
          );
        }
        const plan = pinnedPlanningAgentOutputSchema.parse(planRow.plan);
        if (
          planRow.status !== "approved" ||
          approval.status !== "approved" ||
          approval.metadata?.planId !== planRow.id ||
          approval.metadata?.planSha256 !== plan.identity.sha256 ||
          computePlanningArtifactDigest(plan) !== plan.identity.sha256
        ) {
          throw new DevelopmentLoopTransitionError("Validation review plan identity is invalid.");
        }

        const rows = await tx.select().from(artifacts).where(eq(artifacts.runId, input.runId));
        const exactArtifact = (
          stage: string,
          type: string,
          predicate?: (row: (typeof rows)[number]) => boolean,
        ) => {
          const stageStep = stepByStage.get(stage);
          const matches = rows.filter(
            (row) =>
              row.stepId === stageStep?.id && row.type === type && (!predicate || predicate(row)),
          );
          if (matches.length !== 1) {
            throw new DevelopmentLoopTransitionError(
              `Validation review requires exactly one ${stage} ${type} artifact.`,
            );
          }
          const [match] = matches;
          if (!match) {
            throw new DevelopmentLoopTransitionError(
              `Validation review ${stage} ${type} artifact disappeared.`,
            );
          }
          return match;
        };
        const testPlanArtifact = exactArtifact("test-writing", "test_plan");
        const implementationArtifact = exactArtifact("development", "patch");
        const validationArtifact = exactArtifact("validation", "validation_report");
        const screenshotArtifact = exactArtifact("validation", "screenshot");
        const reviewArtifact = exactArtifact("code-review", "log_summary");
        const testPlan = testPlanArtifactSchema.parse(testPlanArtifact.metadata?.testPlan);
        const implementation = implementationResultSchema.parse(
          implementationArtifact.metadata?.implementationResult,
        );
        const report = validationReportArtifactMetadataSchema.parse(
          validationArtifact.metadata,
        ).validationReport;
        const screenshots = screenshotEvidenceSchema.parse(
          screenshotArtifact.metadata?.screenshotEvidence,
        );
        if (
          report.overallOutcome !== "pass" ||
          report.results.length === 0 ||
          report.results.some(
            (entry) => entry.outcome !== "pass" || (entry.required && entry.outcome !== "pass"),
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review cannot run before completed passing validation.",
          );
        }

        const expectedCriteria = plan.issue.acceptanceCriteria.map((text, index) => ({
          id: `ac-${index + 1}`,
          text,
        }));
        const expectedImplementationBinding = {
          planId: plan.identity.id,
          planSha256: plan.identity.sha256,
          testPlanSha256: computeTestPlanDigest(testPlan),
          testPatchSha256: testPlan.patch.sha256,
          fixturesSha256: computeImplementationDigest(testPlan.fixtures),
          repositoryFullName: plan.issue.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
        };
        if (
          testPlan.plan.id !== plan.identity.id ||
          testPlan.plan.sha256 !== plan.identity.sha256 ||
          testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
          testPlan.plan.commitSha !== plan.repositoryRevision.commitSha ||
          JSON.stringify(testPlan.acceptanceCriteria) !== JSON.stringify(expectedCriteria) ||
          !sameCanonicalValue(implementation.binding, expectedImplementationBinding)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review persisted artifacts do not share the approved handoff binding.",
          );
        }

        const expectedBinding = {
          runId: input.runId,
          reviewAttempt: reviewStep.attempt,
          planId: plan.identity.id,
          planSha256: plan.identity.sha256,
          testPlanSha256: computeTestPlanDigest(testPlan),
          implementationResultSha256: computeImplementationDigest(implementation),
          productionPatchSha256: implementation.patch.sha256,
          validationReportSha256: computeValidationReviewDigest(report),
          screenshotEvidenceSha256: computeScreenshotEvidenceDigest(screenshots),
          repositoryFullName: run.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
        };
        if (
          !sameCanonicalValue(output.binding, expectedBinding) ||
          testPlanArtifact.sha256 !== expectedBinding.testPlanSha256 ||
          implementationArtifact.sha256 !== expectedBinding.implementationResultSha256 ||
          validationArtifact.sha256 !== expectedBinding.validationReportSha256 ||
          screenshotArtifact.sha256 !== expectedBinding.screenshotEvidenceSha256
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review result is not bound to the persisted evidence.",
          );
        }
        assertScreenshotEvidenceBinding(screenshots, {
          repositoryFullName: plan.issue.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
          testPlanSha256: computeTestPlanDigest(testPlan),
          productionPatchSha256: implementation.patch.sha256,
        });
        assertScreenshotEvidenceCoverage(screenshots, {
          uiAffecting: classifyUiAffectingChange({
            productionPaths: implementation.patch.paths,
            tests: testPlan.tests,
          }),
          browserTestIds: screenshotBrowserTests(testPlan.tests).map(({ id }) => id),
        });
        const expectedValidationEvidence = report.results.map(
          ({ key, command, outcome, output }) => ({
            key,
            command,
            outcome: outcome as "pass",
            ...(output?.sha256 ? { outputSha256: output.sha256 } : {}),
          }),
        );
        const expectedScreenshotEvidence = screenshots.captures.map(
          ({ id, testId, viewport, width, height, uri, sha256 }) => ({
            id,
            testId,
            viewport,
            width,
            height,
            uri,
            sha256,
          }),
        );
        if (
          !sameCanonicalValue(output.evidence.validationResults, expectedValidationEvidence) ||
          !sameCanonicalValue(output.evidence.screenshots, expectedScreenshotEvidence)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review citations do not exactly match persisted evidence.",
          );
        }
        if (
          output.recommendation.route !== "commit" &&
          reviewStep.attempt >= developmentLoopMaxAttempts
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review retry budget is exhausted for this run.",
          );
        }

        const claimId = randomUUID();
        const [claimedStep] = await tx
          .update(runSteps)
          .set({ metadata: { ...(reviewStep.metadata ?? {}), validationReviewClaim: claimId } })
          .where(
            and(
              eq(runSteps.id, reviewStep.id),
              sql`not coalesce(${runSteps.metadata} ? 'validationReviewClaim', false)`,
            ),
          )
          .returning({ id: runSteps.id });
        if (!claimedStep) {
          throw new DevelopmentLoopTransitionError(
            `Validation review transition is already in progress for run ${input.runId}.`,
          );
        }

        await tx
          .update(artifacts)
          .set({
            metadata: {
              validationReviewMetadataKind: "validation_review_result",
              validationReviewResult: output,
              validationReviewResultSchemaId: output.schemaId,
              validationReviewVersion: output.version,
            },
            sha256: digest,
          })
          .where(eq(artifacts.id, reviewArtifact.id));

        const route = output.recommendation.route;
        const traceId = reviewStep.traceId ?? run.traceId;
        const historyEntry: ValidationReviewHistoryEntry = {
          attempt: reviewStep.attempt,
          digest,
          findingCount: output.findings.length,
          occurredAt: occurredAt.toISOString(),
          reasonSha256: computeValidationReviewDigest(output.recommendation.reason),
          route,
        };
        const runMetadata = {
          ...metadataWithoutBlockedReason(run.metadata),
          validationReviewHistory: [...priorHistory, historyEntry],
        };

        if (route === "commit") {
          await tx
            .update(runSteps)
            .set({
              completedAt: occurredAt,
              metadata: metadataWithoutExecutionClaims(reviewStep.metadata),
              startedAt: reviewStep.startedAt ?? occurredAt,
              status: "succeeded",
              traceId,
            })
            .where(eq(runSteps.id, reviewStep.id));
          await tx
            .update(loopRuns)
            .set({ currentStage: "commit", metadata: runMetadata, status: "running" })
            .where(eq(loopRuns.id, input.runId));
        } else {
          const resetStages =
            route === "development"
              ? ["development", "validation", "code-review"]
              : ["test-writing", "development", "validation", "code-review"];
          for (const stage of resetStages) {
            const step = stepByStage.get(stage);
            if (!step) throw new DevelopmentLoopTransitionError(`Run is missing ${stage} step.`);
            await tx
              .update(runSteps)
              .set({
                attempt: step.attempt + 1,
                completedAt: null,
                metadata: metadataWithoutExecutionClaims(step.metadata),
                queuedAt: occurredAt,
                startedAt: null,
                status: "queued",
                traceId: step.traceId ?? run.traceId,
                validationStatus:
                  stage === "test-writing" ? "red" : stage === "validation" ? "required" : null,
              })
              .where(eq(runSteps.id, step.id));
          }

          const resetArtifact = async (artifactId: string, metadata: RunMetadata) => {
            await tx
              .update(artifacts)
              .set({ metadata, sha256: null })
              .where(eq(artifacts.id, artifactId));
          };
          if (route === "test-writing") {
            const redArtifact = exactArtifact("test-writing", "validation_report");
            await resetArtifact(testPlanArtifact.id, createTestPlanArtifactContractMetadata());
            await resetArtifact(redArtifact.id, createRedTestEvidenceArtifactContractMetadata());
          }
          await resetArtifact(
            implementationArtifact.id,
            createImplementationArtifactContractMetadata(),
          );
          await resetArtifact(
            validationArtifact.id,
            createValidationReportArtifactContractMetadata(),
          );
          await resetArtifact(
            screenshotArtifact.id,
            createScreenshotEvidenceArtifactContractMetadata(),
          );
          await resetArtifact(reviewArtifact.id, createValidationReviewArtifactContractMetadata());
          await tx
            .update(loopRuns)
            .set({ currentStage: route, metadata: runMetadata, status: "queued" })
            .where(eq(loopRuns.id, input.runId));
          retryMetric = {
            loopKey: run.loopKey,
            reason: "validation-review",
            stage: route,
          };
        }

        return {
          route,
          runId: input.runId,
          stage: "code-review",
          status: route === "commit" ? "advanced" : "requeued",
          stepId: reviewStep.id,
          ...(traceId ? { traceId } : {}),
        };
      },
    );

    emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
      durationSeconds: Math.max(0, Date.now() - transitionStartedAt) / 1000,
      loopKey: "development-loop",
      stage: "code-review",
      status: "succeeded",
    });
    if (retryMetric) {
      emitSafely(input.metrics?.stepRetry ?? recordDevelopmentLoopStepRetryMetric, retryMetric);
    }
    input.logger?.info(
      {
        attempt: output.binding.reviewAttempt,
        durationMs: Math.max(0, Date.now() - transitionStartedAt),
        findingCount: output.findings.length,
        idempotent: result.idempotent,
        route: result.route,
        runId: result.runId,
        screenshotCount: output.evidence.screenshots.length,
        stepId: result.stepId,
        validationEvidenceCount: output.evidence.validationResults.length,
      },
      "validation_review_stage_routed",
    );
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.idempotent": result.idempotent ?? false,
      "loopworks.outcome": result.status,
    });
    markLoopworksSpanOk(span);
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}

function validationGateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function blockedPrStageResult(input: {
  artifactId: string;
  blockedReason: string;
  mode: "development" | "live";
  runId: string;
  stepId: string;
  traceId?: string | null;
}): PrStageTransitionResult {
  return {
    artifactId: input.artifactId,
    blockedReason: input.blockedReason,
    mode: input.mode,
    runId: input.runId,
    stage: "pr",
    status: "blocked",
    stepId: input.stepId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}

export async function executeDevelopmentLoopPrStage(
  input: DevelopmentPrStageInput | LivePrStageInput,
): Promise<PrStageTransitionResult> {
  const now = input.now ?? (() => new Date());
  const occurredAt = input.occurredAt ?? now();
  if (input.mode === "live") {
    let runUrl: URL;
    try {
      runUrl = new URL(input.runUrl);
    } catch {
      throw new DevelopmentLoopTransitionError(
        "Live PR creation requires an HTTPS Loopworks run URL.",
      );
    }
    if (runUrl.protocol !== "https:") {
      throw new DevelopmentLoopTransitionError(
        "Live PR creation requires an HTTPS Loopworks run URL.",
      );
    }
  }
  assertCanonicalLoopworksRunUrl(input.runId, input.runUrl);
  const requestedChangeDigest =
    input.mode === "live"
      ? createPullRequestChangeDigest({
          changes: input.changes,
          commitMessage: input.commitMessage,
        })
      : undefined;

  const prepared = await input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({
        currentStage: loopRuns.currentStage,
        defaultBranch: repositories.defaultBranch,
        githubIssueNumber: loopRuns.githubIssueNumber,
        githubIssueUrl: loopRuns.githubIssueUrl,
        installationId: repositories.installationId,
        loopKey: loopRuns.loopKey,
        metadata: loopRuns.metadata,
        repositoryName: repositories.name,
        repositoryOwner: repositories.owner,
        requiredValidationGates: repositories.validationGates,
        status: loopRuns.status,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);

    if (!run) {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);
    }
    if (!run.githubIssueNumber || !run.githubIssueUrl) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have source issue context.`,
      );
    }

    const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
    const prStep = steps.find((step) => step.stage === "pr");
    const validationStep = steps.find((step) => step.stage === "validation");
    const reviewStep = steps.find((step) => step.stage === "code-review");
    const commitStep = steps.find((step) => step.stage === "commit");
    if (!prStep || !validationStep || !reviewStep || !commitStep) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have the required PR-stage predecessors.`,
      );
    }

    const runArtifacts = await tx.select().from(artifacts).where(eq(artifacts.runId, input.runId));
    const prArtifact = runArtifacts.find(
      (artifact) => artifact.stepId === prStep.id && artifact.type === "pr_intent",
    );
    const validationArtifact = runArtifacts.find(
      (artifact) => artifact.stepId === validationStep.id && artifact.type === "validation_report",
    );
    if (!prArtifact || !validationArtifact) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have the required PR or validation artifact.`,
      );
    }

    if (prStep.completedAt && prStep.status === "succeeded") {
      const pullRequestUrl =
        typeof (prArtifact.metadata as { githubPullRequest?: { url?: unknown } } | null)
          ?.githubPullRequest?.url === "string"
          ? (prArtifact.metadata as { githubPullRequest: { url: string } }).githubPullRequest.url
          : undefined;
      return {
        result: {
          artifactId: prArtifact.id,
          idempotent: true,
          mode: input.mode,
          ...(pullRequestUrl ? { pullRequestUrl } : {}),
          runId: input.runId,
          stage: "pr" as const,
          status: "advanced" as const,
          stepId: prStep.id,
          ...((prStep.traceId ?? run.traceId)
            ? { traceId: prStep.traceId ?? run.traceId ?? undefined }
            : {}),
        },
      };
    }

    const parsedValidation = validationReportArtifactMetadataSchema.safeParse(
      validationArtifact.metadata,
    );
    const validationAdvanced =
      validationStep.status === "succeeded" &&
      parsedValidation.success &&
      parsedValidation.data.validationReport.overallOutcome === "pass" &&
      !parsedValidation.data.validationReport.results.some(
        (result) => result.required && result.outcome === "skipped",
      ) &&
      run.requiredValidationGates
        .map(validationGateKey)
        .filter(Boolean)
        .every((requiredKey) =>
          parsedValidation.data.validationReport.results.some(
            (result) => result.key === requiredKey && result.required && result.outcome === "pass",
          ),
        );
    if (!validationAdvanced) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Deterministic validation did not advance this run.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    if (
      run.currentStage !== "pr" ||
      reviewStep.status !== "succeeded" ||
      commitStep.status !== "succeeded"
    ) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Review and commit stages must succeed before PR creation.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    const parsedPreparation = prPreparationResultSchema.safeParse(
      (prArtifact.metadata as { prPreparationResult?: unknown } | null)?.prPreparationResult,
    );
    const persistedPreparationDigest = (
      prArtifact.metadata as { prPreparationResultSha256?: unknown } | null
    )?.prPreparationResultSha256;
    if (
      !parsedPreparation.success ||
      typeof persistedPreparationDigest !== "string" ||
      prArtifact.sha256 !== persistedPreparationDigest ||
      computePrPreparationDigest(parsedPreparation.data) !== persistedPreparationDigest ||
      parsedPreparation.data.binding.runId !== input.runId ||
      parsedPreparation.data.binding.prAttempt > prStep.attempt
    ) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Typed PR preparation is required before PR creation.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }
    const preparation = parsedPreparation.data;
    const intent = preparation.intent;

    const matchingApprovals = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, prApprovalScope)));
    const approval = matchingApprovals.length === 1 ? matchingApprovals[0] : undefined;

    if (approval?.status !== "approved") {
      const blockedReason = "External write approval is required before PR creation.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "waiting_for_approval",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    if (
      requestedChangeDigest &&
      (approval.metadata as { prChangeDigest?: unknown } | null)?.prChangeDigest !==
        requestedChangeDigest
    ) {
      const blockedReason = "Approved evidence does not match the requested PR changes.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "blocked",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }
    if (
      (approval.metadata as { prIntentDigest?: unknown } | null)?.prIntentDigest !==
      persistedPreparationDigest
    ) {
      const blockedReason = "Approved evidence does not match the prepared PR intent.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "blocked",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    const [claimedStep] = await tx
      .update(runSteps)
      .set({
        completedAt: null,
        metadata: {
          ...(prStep.metadata ?? {}),
          prIntentSchemaId: intent.schemaId,
          prPreparationResultSha256: persistedPreparationDigest,
        },
        startedAt: prStep.startedAt ?? occurredAt,
        status: "running",
        traceId: prStep.traceId ?? run.traceId,
      })
      .where(and(eq(runSteps.id, prStep.id), eq(runSteps.status, "queued")))
      .returning({ id: runSteps.id });
    if (!claimedStep) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} PR step is already in progress or is not retryable.`,
      );
    }

    await tx
      .update(loopRuns)
      .set({
        currentStage: "pr",
        metadata: metadataWithoutBlockedReason(run.metadata),
        status: "running",
      })
      .where(eq(loopRuns.id, input.runId));
    const [claimedApproval] = await tx
      .update(approvals)
      .set({
        metadata: {
          ...(approval.metadata ?? {}),
          prWriteClaim: {
            claimedAt: occurredAt.toISOString(),
            changeDigest: requestedChangeDigest ?? null,
            intentDigest: persistedPreparationDigest,
            runId: input.runId,
          },
        },
      })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "approved")))
      .returning({ id: approvals.id });
    if (!claimedApproval) {
      throw new DevelopmentLoopTransitionError(
        "External write approval changed before the PR stage could claim it.",
      );
    }

    return {
      approval,
      intent,
      preparation,
      preparationDigest: persistedPreparationDigest,
      loopKey: run.loopKey,
      prArtifact,
      prStep,
      repository: run,
    };
  });

  if ("result" in prepared && prepared.result) {
    const result = prepared.result;
    input.logger?.info(
      {
        blockedReason: result.blockedReason,
        idempotent: result.idempotent,
        mode: result.mode,
        runId: result.runId,
        stage: "pr",
        status: result.status,
        stepId: result.stepId,
        traceId: result.traceId,
      },
      result.status === "blocked"
        ? "development_loop_pr_transition_blocked"
        : "development_loop_pr_transition_replayed",
    );
    return result;
  }

  let pullRequest: GitHubPullRequestWriteResult | undefined;
  let completedAt = occurredAt;
  try {
    if (input.mode === "live") {
      if (!prepared.repository.installationId) {
        throw new Error("github_installation_missing");
      }
      pullRequest = await (input.writer ?? createGitHubPullRequest)({
        baseBranch: prepared.repository.defaultBranch,
        body: prepared.intent.body,
        changes: input.changes,
        commitMessage: input.commitMessage,
        draft: true,
        installationId: prepared.repository.installationId,
        owner: prepared.repository.repositoryOwner,
        repo: prepared.repository.repositoryName,
        runId: input.runId,
        title: prepared.intent.title,
      });
      if (
        !pullRequest?.url ||
        !pullRequest.headBranch ||
        !pullRequest.headSha ||
        !Number.isSafeInteger(pullRequest.number)
      ) {
        throw new Error("github_pr_result_invalid");
      }
    }

    completedAt = input.occurredAt ?? now();

    await input.database.transaction(async (tx) => {
      await tx
        .update(runSteps)
        .set({
          completedAt,
          metadata: {
            ...(prepared.prStep.metadata ?? {}),
            prIntentSchemaId: prepared.intent.schemaId,
            ...(pullRequest ? { githubPullRequestNumber: pullRequest.number } : {}),
          },
          status: "succeeded",
        })
        .where(eq(runSteps.id, prepared.prStep.id));
      await tx
        .update(artifacts)
        .set({
          metadata: {
            ...createPrIntentArtifactMetadata(prepared.intent),
            prPreparationResult: prepared.preparation,
            prPreparationResultSchemaId: prepared.preparation.schemaId,
            prPreparationResultSha256: prepared.preparationDigest,
            ...(pullRequest ? { githubPullRequest: pullRequest } : {}),
          },
          ...(pullRequest ? { uri: pullRequest.url } : {}),
        })
        .where(eq(artifacts.id, prepared.prArtifact.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "done",
          metadata: metadataWithoutPrFailure(prepared.repository.metadata),
          status: "running",
        })
        .where(eq(loopRuns.id, input.runId));
      const [appliedApproval] = await tx
        .update(approvals)
        .set({
          metadata: {
            ...approvalMetadataWithoutClaim(prepared.approval.metadata),
            appliedChangeDigest: requestedChangeDigest ?? null,
            appliedIntentDigest: prepared.preparationDigest,
          },
          status: "applied",
        })
        .where(and(eq(approvals.id, prepared.approval.id), eq(approvals.status, "approved")))
        .returning({ id: approvals.id });
      if (!appliedApproval) {
        throw new DevelopmentLoopTransitionError(
          "External write approval changed before PR finalization.",
        );
      }
      await tx.insert(approvalTransitionEvents).values({
        action: "apply",
        actorId:
          input.mode === "live" ? input.actorId : (prepared.approval.resolvedBy ?? "maintainer"),
        approvalId: prepared.approval.id,
        fromStatus: "approved",
        metadata: { mode: input.mode, stage: "pr" },
        note: "PR stage completed after guarded external-write approval.",
        occurredAt: completedAt,
        runId: input.runId,
        toStatus: "applied",
      });
    });
  } catch {
    const failedAt = input.occurredAt ?? now();
    await input.database.transaction(async (tx) => {
      await tx
        .update(runSteps)
        .set({
          completedAt: failedAt,
          metadata: {
            ...(prepared.prStep.metadata ?? {}),
            failureCode: "github_pr_creation_failed",
            retryable: true,
          },
          status: "failed",
        })
        .where(eq(runSteps.id, prepared.prStep.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: {
            ...(prepared.repository.metadata ?? {}),
            failureCode: "github_pr_creation_failed",
            retryable: true,
          },
          status: "failed",
        })
        .where(eq(loopRuns.id, input.runId));
      await tx
        .update(approvals)
        .set({ metadata: approvalMetadataWithoutClaim(prepared.approval.metadata) })
        .where(and(eq(approvals.id, prepared.approval.id), eq(approvals.status, "approved")));
    });
    emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
      durationSeconds: durationSecondsBetween(prepared.prStep.startedAt ?? occurredAt, failedAt),
      loopKey: prepared.loopKey,
      stage: "pr",
      status: "failed",
    });
    input.logger?.error(
      {
        failureCode: "github_pr_creation_failed",
        runId: input.runId,
        stage: "pr",
        stepId: prepared.prStep.id,
        traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined,
      },
      "development_loop_pr_transition_failed",
    );
    throw new DevelopmentLoopTransitionError(
      "PR creation failed; the step is ready for inspection and retry.",
    );
  }

  emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
    durationSeconds: durationSecondsBetween(prepared.prStep.startedAt ?? occurredAt, completedAt),
    loopKey: prepared.loopKey,
    stage: "pr",
    status: "succeeded",
  });
  input.logger?.info(
    {
      mode: input.mode,
      pullRequestNumber: pullRequest?.number,
      runId: input.runId,
      stage: "pr",
      stepId: prepared.prStep.id,
      traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined,
    },
    "development_loop_pr_transition_persisted",
  );

  return {
    artifactId: prepared.prArtifact.id,
    mode: input.mode,
    ...(pullRequest ? { pullRequestUrl: pullRequest.url } : {}),
    runId: input.runId,
    stage: "pr",
    status: "advanced",
    stepId: prepared.prStep.id,
    ...((prepared.prStep.traceId ?? prepared.repository.traceId)
      ? { traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined }
      : {}),
  };
}

function terminalStatusForReason(
  reason: DevelopmentLoopTerminalReason,
): DevelopmentLoopTerminalStatus {
  if (reason === "succeeded") return "succeeded";
  if (reason === "canceled_by_reconciliation") return "canceled";
  return "failed";
}

function terminalReasonForStatus(
  status: DevelopmentLoopTerminalStatus,
): DevelopmentLoopTerminalReason {
  if (status === "succeeded") return "succeeded";
  if (status === "canceled") return "canceled_by_reconciliation";
  return "failed";
}

export async function finalizeDevelopmentLoopRun(input: {
  database: DevelopmentLoopTransitionDatabase;
  expectedCurrentStage?: string;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  reason: DevelopmentLoopTerminalReason;
  runId: string;
}): Promise<{
  durationSeconds: number;
  idempotent?: boolean;
  reason: DevelopmentLoopTerminalReason;
  runId: string;
  status: DevelopmentLoopTerminalStatus;
  traceId?: string;
}> {
  const occurredAt = input.occurredAt ?? new Date();
  let runCompletedMetric: DevelopmentLoopRunCompletedMetricInput | undefined;
  let runDurationMetric: DevelopmentLoopRunDurationMetricInput | undefined;
  const status = terminalStatusForReason(input.reason);

  const result = await input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({
        completedAt: loopRuns.completedAt,
        currentStage: loopRuns.currentStage,
        id: loopRuns.id,
        loopKey: loopRuns.loopKey,
        metadata: loopRuns.metadata,
        queuedAt: loopRuns.queuedAt,
        repository: repositories.fullName,
        repositoryId: loopRuns.repositoryId,
        startedAt: loopRuns.startedAt,
        status: loopRuns.status,
        terminalReason: loopRuns.terminalReason,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);

    if (!run) {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);
    }

    if (
      run.completedAt &&
      (run.status === "succeeded" || run.status === "failed" || run.status === "canceled")
    ) {
      return {
        durationSeconds: durationSecondsBetween(run.startedAt ?? run.queuedAt, run.completedAt),
        idempotent: true,
        reason: run.terminalReason ?? terminalReasonForStatus(run.status),
        runId: input.runId,
        status: run.status as DevelopmentLoopTerminalStatus,
        ...(run.traceId ? { traceId: run.traceId } : {}),
      };
    }

    const durationSeconds = durationSecondsBetween(run.startedAt ?? run.queuedAt, occurredAt);
    const [currentStep] = await tx
      .select({ id: runSteps.id, traceId: runSteps.traceId })
      .from(runSteps)
      .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, run.currentStage)))
      .limit(1);
    const updatePredicates = [
      eq(loopRuns.id, input.runId),
      notInArray(loopRuns.status, ["succeeded", "failed", "canceled"]),
      ...(input.expectedCurrentStage
        ? [eq(loopRuns.currentStage, input.expectedCurrentStage)]
        : []),
    ];
    const [updated] = await tx
      .update(loopRuns)
      .set({
        ...(status === "canceled" ? { canceledAt: occurredAt } : {}),
        completedAt: occurredAt,
        currentStage: status === "succeeded" ? "done" : run.currentStage,
        status,
        terminalReason: input.reason,
      })
      .where(and(...updatePredicates))
      .returning({ id: loopRuns.id });

    if (!updated) {
      const [terminalRun] = await tx
        .select({
          completedAt: loopRuns.completedAt,
          queuedAt: loopRuns.queuedAt,
          startedAt: loopRuns.startedAt,
          status: loopRuns.status,
          terminalReason: loopRuns.terminalReason,
          traceId: loopRuns.traceId,
        })
        .from(loopRuns)
        .where(eq(loopRuns.id, input.runId))
        .limit(1);
      if (
        !terminalRun?.completedAt ||
        !["succeeded", "failed", "canceled"].includes(terminalRun.status)
      ) {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} could not be finalized because its state changed.`,
        );
      }
      return {
        durationSeconds: durationSecondsBetween(
          terminalRun.startedAt ?? terminalRun.queuedAt,
          terminalRun.completedAt,
        ),
        idempotent: true,
        reason:
          terminalRun.terminalReason ??
          terminalReasonForStatus(terminalRun.status as DevelopmentLoopTerminalStatus),
        runId: input.runId,
        status: terminalRun.status as DevelopmentLoopTerminalStatus,
        ...(terminalRun.traceId ? { traceId: terminalRun.traceId } : {}),
      };
    }

    await recordDevelopmentLoopRunCompletedObservability({
      durationSeconds,
      loopKey: run.loopKey,
      repositoryFullName: run.repository,
      repositoryId: run.repositoryId,
      runId: input.runId,
      status,
      stepId: currentStep?.id,
      terminalReason: input.reason,
      traceId: currentStep?.traceId ?? run.traceId ?? undefined,
      writer: tx,
    });

    runCompletedMetric = {
      loopKey: run.loopKey,
      repository: run.repository,
      status,
    };
    runDurationMetric = {
      durationSeconds,
      loopKey: run.loopKey,
      status,
    };

    return {
      durationSeconds,
      reason: input.reason,
      runId: input.runId,
      status,
      ...(run.traceId ? { traceId: run.traceId } : {}),
    };
  });

  if (runCompletedMetric) {
    emitSafely(
      input.metrics?.runCompleted ?? recordDevelopmentLoopRunCompletedMetric,
      runCompletedMetric,
    );
  }
  if (runDurationMetric) {
    emitSafely(
      input.metrics?.runDuration ?? recordDevelopmentLoopRunDurationMetric,
      runDurationMetric,
    );
  }

  input.logger?.info(
    {
      durationSeconds: result.durationSeconds,
      idempotent: "idempotent" in result ? result.idempotent : undefined,
      reason: result.reason,
      runId: result.runId,
      status: result.status,
      traceId: "traceId" in result ? result.traceId : undefined,
    },
    developmentLoopRunCompletedEventType,
  );

  return result;
}

export async function completeDevelopmentLoopRun(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  reason?: DevelopmentLoopTerminalReason;
  runId: string;
  status: DevelopmentLoopTerminalStatus;
}): ReturnType<typeof finalizeDevelopmentLoopRun> {
  if (input.status === "canceled" && input.reason === undefined) {
    throw new DevelopmentLoopTransitionError(
      "Canceled runs require an explicit typed terminal reason.",
    );
  }
  const reason = input.reason ?? terminalReasonForStatus(input.status);
  if (terminalStatusForReason(reason) !== input.status) {
    throw new DevelopmentLoopTransitionError(
      `Terminal reason ${reason} does not match status ${input.status}.`,
    );
  }
  return finalizeDevelopmentLoopRun({
    database: input.database,
    logger: input.logger,
    metrics: input.metrics,
    occurredAt: input.occurredAt,
    reason,
    runId: input.runId,
  });
}

export async function retryDevelopmentLoopStep(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  reason: string;
  runId: string;
  stage: string;
}): Promise<{
  attempt: number;
  idempotent?: boolean;
  runId: string;
  stage: string;
  stepId: string;
  traceId?: string;
}> {
  const occurredAt = input.occurredAt ?? new Date();
  let retryMetric: DevelopmentLoopStepRetryMetricInput | undefined;
  const reason = normalizeReasonCode(input.reason) ?? "unspecified";

  const result = await input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({
        id: loopRuns.id,
        loopKey: loopRuns.loopKey,
        metadata: loopRuns.metadata,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .where(eq(loopRuns.id, input.runId))
      .limit(1);

    if (!run) {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);
    }

    const [step] = await tx
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, input.stage)))
      .limit(1);

    if (!step) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have a ${input.stage} step.`,
      );
    }

    if (step.status !== "failed") {
      const traceId = step.traceId ?? run.traceId ?? undefined;
      return {
        attempt: step.attempt,
        idempotent: true,
        runId: input.runId,
        stage: input.stage,
        stepId: step.id,
        ...(traceId ? { traceId } : {}),
      };
    }

    const attempt = step.attempt + 1;
    await tx
      .update(runSteps)
      .set({
        attempt,
        completedAt: null,
        metadata: {
          ...(step.metadata ?? {}),
          lastRetryReason: reason,
          retriedAt: occurredAt.toISOString(),
        },
        queuedAt: occurredAt,
        startedAt: null,
        status: "queued",
        traceId: step.traceId ?? run.traceId,
      })
      .where(eq(runSteps.id, step.id));

    await tx
      .update(loopRuns)
      .set({
        currentStage: input.stage,
        metadata: {
          ...metadataWithoutBlockedReason(run.metadata),
          lastRetryReason: reason,
          retryStage: input.stage,
        },
        status: "queued",
      })
      .where(eq(loopRuns.id, input.runId));

    retryMetric = {
      loopKey: run.loopKey,
      reason,
      stage: input.stage,
    };

    return {
      attempt,
      runId: input.runId,
      stage: input.stage,
      stepId: step.id,
      ...((step.traceId ?? run.traceId)
        ? { traceId: step.traceId ?? run.traceId ?? undefined }
        : {}),
    };
  });

  if (retryMetric) {
    emitSafely(input.metrics?.stepRetry ?? recordDevelopmentLoopStepRetryMetric, retryMetric);
  }

  input.logger?.info(
    {
      attempt: result.attempt,
      idempotent: "idempotent" in result ? result.idempotent : undefined,
      runId: result.runId,
      stage: result.stage,
      stepId: result.stepId,
      traceId: "traceId" in result ? result.traceId : undefined,
    },
    "development_loop_step_retry_queued",
  );

  return result;
}
