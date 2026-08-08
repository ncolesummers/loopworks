import { and, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { idempotencyLocks, runSteps } from "@/db/schema";
import type {
  DevelopmentLoopRunCompletedMetricInput,
  DevelopmentLoopRunDurationMetricInput,
  DevelopmentLoopStepDurationMetricInput,
  DevelopmentLoopStepRetryMetricInput,
  DevelopmentLoopValidationDurationMetricInput,
  DevelopmentLoopValidationOutcomeMetricInput,
} from "@/lib/observability/metrics";

export type DevelopmentLoopTransitionDatabase = Pick<typeof db, "transaction">;

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

export type RunMetadata = Record<string, unknown>;

export const prApprovalScope = "external-write-review";

export class DevelopmentLoopTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentLoopTransitionError";
  }
}

export async function assertDevelopmentLoopExecutionLease(
  tx: Parameters<Parameters<DevelopmentLoopTransitionDatabase["transaction"]>[0]>[0],
  runId: string,
  stage?: string,
): Promise<void> {
  const [lease] = await tx
    .select({ id: idempotencyLocks.id })
    .from(idempotencyLocks)
    .where(
      and(
        eq(idempotencyLocks.runId, runId),
        eq(idempotencyLocks.owner, runId),
        eq(idempotencyLocks.status, "acquired"),
      ),
    )
    .limit(1);
  if (lease) return;
  const [completedStep] = stage
    ? await tx
        .select({ completedAt: runSteps.completedAt, status: runSteps.status })
        .from(runSteps)
        .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, stage)))
        .limit(1)
    : [];
  if (completedStep?.status === "succeeded" && completedStep.completedAt) return;
  throw new DevelopmentLoopTransitionError(
    `Run ${runId} does not own an acquired execution lease.`,
  );
}

export function durationSecondsBetween(startedAt: Date, completedAt: Date): number {
  return Math.max(0, (completedAt.getTime() - startedAt.getTime()) / 1000);
}

export function metadataWithoutBlockedReason(
  metadata: RunMetadata | null | undefined,
): RunMetadata {
  const { blockedReason: _blockedReason, ...rest } = metadata ?? {};
  return rest;
}

export function emitSafely<T>(recorder: ((input: T) => void) | undefined, input: T): void {
  try {
    recorder?.(input);
  } catch {
    // Runtime state transitions must remain authoritative when telemetry sinks fail.
  }
}

export type ValidationReviewHistoryEntry = {
  attempt: number;
  digest: string;
  findingCount: number;
  occurredAt: string;
  reasonSha256: string;
  route: "commit" | "development" | "test-writing";
};

export function validationReviewHistory(
  metadata: RunMetadata | null,
): ValidationReviewHistoryEntry[] {
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
