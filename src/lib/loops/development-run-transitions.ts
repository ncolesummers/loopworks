import { and, eq } from "drizzle-orm";

import type { db } from "@/db/client";
import { artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { createValidationReportArtifactMetadata } from "@/lib/loops/validation-report";
import type { ValidationGateResultV1, ValidationReportV1 } from "@/lib/loops/validation-report";
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

export type DevelopmentLoopTransitionDatabase = Pick<typeof db, "transaction">;

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

export class DevelopmentLoopTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentLoopTransitionError";
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
  if (report.results.length === 0) {
    return ["validation_report"];
  }

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
      return {
        ...(step.status === "failed"
          ? { blockedReason: "Validation transition already failed." }
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
        metadata: {
          ...(artifact.metadata ?? {}),
          ...createValidationReportArtifactMetadata(input.report),
        },
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
