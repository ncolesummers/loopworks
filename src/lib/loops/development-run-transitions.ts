import { randomUUID } from "node:crypto";

import {
  computePlanningArtifactDigest,
  pinnedPlanningAgentOutputSchema,
  planningAgentOutputSchema,
} from "@agent/planning-agent";
import { verifyTestExecutionReceipt } from "@agent/subagents/test-writer/lib/tool-policy";
import {
  computeTestPlanDigest,
  type TestWritingAgentOutput,
  testWritingAgentOutputSchema,
} from "@agent/test-writing-agent";
import { and, desc, eq, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import {
  agentPlans,
  approvals,
  approvalTransitionEvents,
  artifacts,
  deployments,
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
import { composePrIntent, createPrIntentArtifactMetadata } from "@/lib/loops/pr-intent";
import type { ValidationGateResultV1, ValidationReportV1 } from "@/lib/loops/validation-report";
import {
  createValidationReportArtifactMetadata,
  validationReportArtifactMetadataSchema,
} from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  type DevelopmentLoopRunCompletedMetricInput,
  type DevelopmentLoopRunDurationMetricInput,
  type DevelopmentLoopStepDurationMetricInput,
  type DevelopmentLoopStepRetryMetricInput,
  type DevelopmentLoopValidationDurationMetricInput,
  type DevelopmentLoopValidationOutcomeMetricInput,
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
}): Promise<ValidationTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
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

    const [artifact] = await tx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, input.runId),
          eq(artifacts.stepId, step.id),
          eq(artifacts.type, "validation_report"),
        ),
      )
      .limit(1);

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

    const blockedReason = getBlockedReason(input.report, input.expectedValidationGates);
    const stepStatus = blockedReason ? "failed" : "succeeded";
    const stepDurationMs = sumValidationDurationMs(input.report);
    const stepStartedAt = getStartedAtForDuration({
      completedAt: occurredAt,
      durationMs: stepDurationMs,
      startedAt: step.startedAt,
    });
    const stepDurationSeconds = durationSecondsBetween(stepStartedAt, occurredAt);
    const traceId = step.traceId ?? run.traceId;
    const requiredSkippedCount = requiredSkippedResults(input.report).length;

    await tx
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(input.report),
      })
      .where(eq(artifacts.id, artifact.id));

    await tx
      .update(runSteps)
      .set({
        completedAt: occurredAt,
        metadata: createStepValidationMetadata({
          metadata: step.metadata,
          report: input.report,
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
          report: input.report,
        }),
        startedAt: run.startedAt ?? run.queuedAt,
        status: blockedReason ? "blocked" : "running",
      })
      .where(eq(loopRuns.id, input.runId));

    metricInputs = createValidationMetricInputs({
      loopKey: run.loopKey,
      report: input.report,
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

function issueTitleFromMetadata(
  metadata: RunMetadata | null | undefined,
  issueNumber: number,
): string {
  const title = metadata?.issueTitle;
  return typeof title === "string" && title.trim() ? title : `Issue #${issueNumber}`;
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

    const matchingApprovals = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, prApprovalScope)));
    const approval = matchingApprovals.length === 1 ? matchingApprovals[0] : undefined;

    const [deployment] = await tx
      .select()
      .from(deployments)
      .where(eq(deployments.runId, input.runId))
      .orderBy(desc(deployments.createdAt))
      .limit(1);
    const intent = composePrIntent({
      artifacts: runArtifacts
        .filter((artifact) => artifact.id !== prArtifact.id)
        .map((artifact) => ({
          title: artifact.title,
          type: artifact.type,
          uri: artifact.uri,
        })),
      ...(requestedChangeDigest ? { changeDigest: requestedChangeDigest } : {}),
      ...(deployment
        ? {
            deployment: {
              ...(deployment.branch ? { branch: deployment.branch } : {}),
              ...(deployment.commitSha ? { commitSha: deployment.commitSha } : {}),
              environment: deployment.environment,
              status: deployment.status,
              url: deployment.url,
            },
          }
        : {}),
      issue: {
        number: run.githubIssueNumber,
        title: issueTitleFromMetadata(run.metadata, run.githubIssueNumber),
        url: run.githubIssueUrl,
      },
      run: { id: input.runId, url: input.runUrl },
      validation: {
        artifactUri: validationArtifact.uri,
        report: parsedValidation.data.validationReport,
      },
    });

    await tx
      .update(artifacts)
      .set({
        metadata: createPrIntentArtifactMetadata(intent),
      })
      .where(eq(artifacts.id, prArtifact.id));

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

    const [claimedStep] = await tx
      .update(runSteps)
      .set({
        completedAt: null,
        metadata: {
          ...(prStep.metadata ?? {}),
          prIntentSchemaId: intent.schemaId,
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

export async function completeDevelopmentLoopRun(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  reason?: string;
  runId: string;
  status: DevelopmentLoopTerminalStatus;
}): Promise<{
  durationSeconds: number;
  idempotent?: boolean;
  runId: string;
  status: DevelopmentLoopTerminalStatus;
  traceId?: string;
}> {
  const occurredAt = input.occurredAt ?? new Date();
  let runCompletedMetric: DevelopmentLoopRunCompletedMetricInput | undefined;
  let runDurationMetric: DevelopmentLoopRunDurationMetricInput | undefined;
  const terminalReason = normalizeReasonCode(input.reason);

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
        startedAt: loopRuns.startedAt,
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

    if (
      run.completedAt &&
      (run.status === "succeeded" || run.status === "failed" || run.status === "canceled")
    ) {
      return {
        durationSeconds: durationSecondsBetween(run.startedAt ?? run.queuedAt, run.completedAt),
        idempotent: true,
        runId: input.runId,
        status: run.status as DevelopmentLoopTerminalStatus,
        ...(run.traceId ? { traceId: run.traceId } : {}),
      };
    }

    const durationSeconds = durationSecondsBetween(run.startedAt ?? run.queuedAt, occurredAt);
    await tx
      .update(loopRuns)
      .set({
        ...(input.status === "canceled" ? { canceledAt: occurredAt } : {}),
        completedAt: occurredAt,
        currentStage: input.status === "succeeded" ? "done" : run.currentStage,
        metadata: {
          ...(run.metadata ?? {}),
          ...(terminalReason ? { terminalReason } : {}),
        },
        status: input.status,
      })
      .where(eq(loopRuns.id, input.runId));

    runCompletedMetric = {
      loopKey: run.loopKey,
      repository: run.repository,
      status: input.status,
    };
    runDurationMetric = {
      durationSeconds,
      loopKey: run.loopKey,
      status: input.status,
    };

    return {
      durationSeconds,
      runId: input.runId,
      status: input.status,
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
      runId: result.runId,
      status: result.status,
      traceId: "traceId" in result ? result.traceId : undefined,
    },
    "development_loop_run_completed",
  );

  return result;
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
