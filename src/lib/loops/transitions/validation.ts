import { implementationResultSchema } from "@agent/implementation-agent";
import { computeTestPlanDigest, testPlanArtifactSchema } from "@agent/test-writing-agent";
import { computeValidationReviewDigest } from "@agent/validation-review-agent";
import { and, eq } from "drizzle-orm";
import { artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  assertScreenshotEvidenceBinding,
  assertScreenshotEvidenceCoverage,
  classifyUiAffectingChange,
  computeScreenshotEvidenceDigest,
  createScreenshotEvidenceArtifactMetadata,
  type ScreenshotEvidence,
  screenshotBrowserTests,
  screenshotEvidenceSchema,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationGateResultV1, ValidationReportV1 } from "@/lib/loops/validation-report";
import {
  createValidationReportArtifactMetadata,
  validationReportV1Schema,
} from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  type DevelopmentLoopStepDurationMetricInput,
  type DevelopmentLoopValidationDurationMetricInput,
  type DevelopmentLoopValidationOutcomeMetricInput,
  recordDevelopmentLoopStepDurationMetric,
  recordDevelopmentLoopValidationDurationMetric,
  recordDevelopmentLoopValidationOutcomeMetric,
} from "@/lib/observability/metrics";

import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  type DevelopmentLoopValidationTransitionStatus,
  durationSecondsBetween,
  emitSafely,
  metadataWithoutBlockedReason,
  type RunMetadata,
} from "./shared";

export type ExpectedValidationGate = {
  key: string;
  required: boolean;
};

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

function getPersistedBlockedReason(metadata: RunMetadata | null | undefined): string | undefined {
  const blockedReason = metadata?.blockedReason;
  return typeof blockedReason === "string" && blockedReason.length > 0 ? blockedReason : undefined;
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
    await assertDevelopmentLoopExecutionLease(tx, input.runId, "validation");
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
