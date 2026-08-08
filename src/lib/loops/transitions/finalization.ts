import { and, eq, isNull } from "drizzle-orm";
import { idempotencyLocks, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  calculateDevelopmentLoopRetryDelaySeconds,
  type DevelopmentLoopRunDatabase,
  developmentLoopKey,
  drainDevelopmentLoopDispatchQueue,
  insertLinkedDevelopmentLoopRetryInTransaction,
} from "@/lib/loops/development-run";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { logger as defaultLogger, type LoopworksLogger } from "@/lib/observability/logger";
import {
  type DevelopmentLoopRunCompletedMetricInput,
  type DevelopmentLoopRunDurationMetricInput,
  type DevelopmentLoopStepRetryMetricInput,
  developmentLoopRunCompletedEventType,
  recordDevelopmentLoopRunCompletedMetric,
  recordDevelopmentLoopRunCompletedObservability,
  recordDevelopmentLoopRunDurationMetric,
  recordDevelopmentLoopStepRetryMetric,
} from "@/lib/observability/metrics";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startDevelopmentLoopRetrySpan,
} from "@/lib/observability/trace-context";
import type { LoopManifest } from "../../../../schemas/loop-manifest";

import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTerminalReason,
  type DevelopmentLoopTerminalStatus,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  durationSecondsBetween,
  emitSafely,
  metadataWithoutBlockedReason,
} from "./shared";

const safeReasonCodePattern = /^[a-z][a-z0-9_.:-]{0,79}$/;

function normalizeReasonCode(reason: string | undefined): string | undefined {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return safeReasonCodePattern.test(normalized) ? normalized : "unspecified";
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
  manifest?: LoopManifest;
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
  let linkedRetry: { eligibleAt: Date; emitObservability: () => void; runId: string } | undefined;
  let drainRepositoryFullName: string | undefined;
  let repairedTerminalLease = false;
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
    drainRepositoryFullName = run.repository;

    if (
      run.completedAt &&
      (run.status === "succeeded" || run.status === "failed" || run.status === "canceled")
    ) {
      const repairedLeases = await tx
        .update(idempotencyLocks)
        .set({ releasedAt: run.completedAt, status: "released" })
        .where(
          and(
            eq(idempotencyLocks.runId, input.runId),
            eq(idempotencyLocks.owner, input.runId),
            eq(idempotencyLocks.status, "acquired"),
          ),
        )
        .returning({ id: idempotencyLocks.id });
      repairedTerminalLease = repairedLeases.length > 0;
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
      isNull(loopRuns.completedAt),
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
      const repairedLeases = await tx
        .update(idempotencyLocks)
        .set({ releasedAt: terminalRun.completedAt, status: "released" })
        .where(
          and(
            eq(idempotencyLocks.runId, input.runId),
            eq(idempotencyLocks.owner, input.runId),
            eq(idempotencyLocks.status, "acquired"),
          ),
        )
        .returning({ id: idempotencyLocks.id });
      repairedTerminalLease = repairedLeases.length > 0;
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

    await tx
      .update(idempotencyLocks)
      .set({
        releasedAt: occurredAt,
        status: "released",
      })
      .where(
        and(
          eq(idempotencyLocks.runId, input.runId),
          eq(idempotencyLocks.owner, input.runId),
          eq(idempotencyLocks.status, "acquired"),
        ),
      );

    if (input.reason === "stalled" || input.reason === "timed_out") {
      linkedRetry = await insertLinkedDevelopmentLoopRetryInTransaction({
        manifest: input.manifest ?? defaultLoopManifest,
        occurredAt,
        reason: input.reason,
        repository: { fullName: run.repository, id: run.repositoryId },
        sourceMetadata: run.metadata,
        sourceRunId: input.runId,
        traceId: run.traceId ?? undefined,
        writer: tx,
      });
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
  try {
    linkedRetry?.emitObservability();
  } catch {
    // Terminal evidence and linked retry creation already committed.
  }
  if (linkedRetry) {
    (input.logger ?? defaultLogger).info(
      {
        eligibleAt: linkedRetry.eligibleAt.toISOString(),
        loopKey: developmentLoopKey,
        reason: input.reason,
        runId: linkedRetry.runId,
      },
      "development_loop_retry_scheduled",
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

  if (!("idempotent" in result && result.idempotent) || repairedTerminalLease) {
    try {
      await drainDevelopmentLoopDispatchQueue({
        clock: () => occurredAt,
        database: input.database as DevelopmentLoopRunDatabase,
        manifest: input.manifest ?? defaultLoopManifest,
        repositoryFullName: drainRepositoryFullName,
      });
    } catch (error) {
      (input.logger ?? defaultLogger).error(
        {
          error: error instanceof Error ? error.message : "unknown",
          loopKey: developmentLoopKey,
          runId: input.runId,
        },
        "development_loop_dispatch_drain_failed",
      );
    }
  }

  return result;
}

export async function completeDevelopmentLoopRun(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  manifest?: LoopManifest;
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
    manifest: input.manifest,
    metrics: input.metrics,
    occurredAt: input.occurredAt,
    reason,
    runId: input.runId,
  });
}

export async function scheduleDevelopmentLoopStageRetry(input: {
  database: DevelopmentLoopTransitionDatabase;
  failure: { code: string; retryable: boolean };
  logger?: LoopworksLogger;
  manifest: LoopManifest;
  occurredAt?: Date;
  runId: string;
  stage: string;
  traceId?: string;
}): Promise<{
  attempt: number;
  eligibleAt?: Date;
  runId: string;
  stage: string;
  status: "exhausted" | "ineligible" | "scheduled";
}> {
  const occurredAt = input.occurredAt ?? new Date();
  const loopManifest = input.manifest.loops.find(({ key }) => key === developmentLoopKey);
  if (!loopManifest) {
    throw new DevelopmentLoopTransitionError(`Manifest does not define ${developmentLoopKey}.`);
  }
  const retrySpan = startDevelopmentLoopRetrySpan({ traceId: input.traceId });
  const reason = normalizeReasonCode(input.failure.code) ?? "unspecified";

  const decision = await input.database
    .transaction(async (tx) => {
      const [run] = await tx
        .select({
          completedAt: loopRuns.completedAt,
          metadata: loopRuns.metadata,
          status: loopRuns.status,
        })
        .from(loopRuns)
        .where(eq(loopRuns.id, input.runId))
        .for("update")
        .limit(1);
      const [step] = await tx
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, input.stage)))
        .limit(1);
      if (!run || !step) {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} does not have a ${input.stage} step.`,
        );
      }
      const runMetadata = (run.metadata ?? {}) as Record<string, unknown>;
      const completedAttempt =
        typeof runMetadata.dispatchAttempt === "number" ? runMetadata.dispatchAttempt : 1;
      const existingSchedule =
        runMetadata.scheduledRetry && typeof runMetadata.scheduledRetry === "object"
          ? (runMetadata.scheduledRetry as Record<string, unknown>)
          : undefined;
      if (
        run.status === "queued" &&
        existingSchedule?.stage === input.stage &&
        existingSchedule.completedAttempt === completedAttempt &&
        existingSchedule.stepAttempt === step.attempt &&
        typeof existingSchedule.eligibleAt === "string"
      ) {
        return {
          attempt: completedAttempt,
          eligibleAt: new Date(existingSchedule.eligibleAt),
          status: "scheduled" as const,
        };
      }
      const storedFailure =
        step.metadata && typeof step.metadata === "object"
          ? (step.metadata as Record<string, unknown>).failure
          : undefined;
      const hasBoundedRetryMarker =
        storedFailure !== null &&
        typeof storedFailure === "object" &&
        (storedFailure as Record<string, unknown>).retryable === true &&
        typeof (storedFailure as Record<string, unknown>).code === "string";
      const authorized =
        step.status === "failed" &&
        run.completedAt === null &&
        run.status === "failed" &&
        input.failure.retryable &&
        hasBoundedRetryMarker &&
        loopManifest.retryPolicy.retryableStatuses.includes("failed");
      if (!authorized || completedAttempt >= loopManifest.retryPolicy.maxAttempts) {
        return {
          attempt: completedAttempt,
          status: (authorized ? "exhausted" : "ineligible") as "exhausted" | "ineligible",
        };
      }

      const delaySeconds = calculateDevelopmentLoopRetryDelaySeconds({
        backoff: loopManifest.retryPolicy.backoff,
        completedAttempt,
      });
      const eligibleAt = new Date(occurredAt.getTime() + delaySeconds * 1_000);
      await tx
        .update(loopRuns)
        .set({
          currentStage: input.stage,
          metadata: {
            ...runMetadata,
            scheduledRetry: {
              completedAttempt,
              eligibleAt: eligibleAt.toISOString(),
              reason,
              stage: input.stage,
              stepAttempt: step.attempt,
            },
          },
          queuedAt: eligibleAt,
          status: "queued",
        })
        .where(
          and(
            eq(loopRuns.id, input.runId),
            eq(loopRuns.status, "failed"),
            isNull(loopRuns.completedAt),
          ),
        );
      await tx
        .update(idempotencyLocks)
        .set({ releasedAt: occurredAt, status: "released" })
        .where(
          and(
            eq(idempotencyLocks.runId, input.runId),
            eq(idempotencyLocks.owner, input.runId),
            eq(idempotencyLocks.status, "acquired"),
          ),
        );
      return { attempt: completedAttempt, eligibleAt, status: "scheduled" as const };
    })
    .catch((error) => {
      markLoopworksSpanError(retrySpan.span, error);
      retrySpan.span.end();
      throw error;
    });

  try {
    if (decision.status === "exhausted") {
      await finalizeDevelopmentLoopRun({
        database: input.database,
        logger: input.logger,
        manifest: input.manifest,
        occurredAt,
        reason: "failed",
        runId: input.runId,
      });
      (input.logger ?? defaultLogger).info(
        { attempt: decision.attempt, loopKey: developmentLoopKey, reason, runId: input.runId },
        "development_loop_retry_exhausted",
      );
    } else if (decision.status === "scheduled") {
      (input.logger ?? defaultLogger).info(
        { attempt: decision.attempt, loopKey: developmentLoopKey, reason, runId: input.runId },
        "development_loop_retry_scheduled",
      );
    }
    retrySpan.setOutcome(decision.status);
    markLoopworksSpanOk(retrySpan.span);
    retrySpan.span.end();
    return { ...decision, runId: input.runId, stage: input.stage };
  } catch (error) {
    markLoopworksSpanError(retrySpan.span, error);
    retrySpan.span.end();
    throw error;
  }
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
        completedAt: loopRuns.completedAt,
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
    if (run.completedAt) {
      throw new DevelopmentLoopTransitionError(`Cannot retry terminal run ${input.runId}.`);
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

    const runMetadata = (run.metadata ?? {}) as Record<string, unknown>;
    if (runMetadata.scheduledRetry && typeof runMetadata.scheduledRetry === "object") {
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

    await assertDevelopmentLoopExecutionLease(tx, input.runId);

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
