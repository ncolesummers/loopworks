import { and, eq, sql } from "drizzle-orm";

import { approvals, approvalTransitionEvents } from "@/db/schema";
import {
  type ApprovalAction,
  ApprovalExpectedStatusError,
  ApprovalNotFoundError,
  ApprovalWriteInProgressError,
  type ApprovalStatus,
  type ApprovalTransition,
  type ApprovalTransitionDatabase,
  transitionApproval,
} from "@/lib/approvals";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  type ApprovalWaitTimeMetricInput,
  recordApprovalWaitTimeMetric,
} from "@/lib/observability/metrics";

export type ApplyApprovalTransitionInput = {
  action: ApprovalAction;
  actorId: string;
  approvalId: string;
  authMode?: "fixture" | "github";
  database: ApprovalTransitionDatabase;
  expectedStatus: ApprovalStatus;
  logger?: LoopworksLogger;
  note?: string;
  occurredAt?: Date;
  recordApprovalWaitTimeMetric?: (input: ApprovalWaitTimeMetricInput) => void;
};

export type AppliedApprovalTransition = {
  approvalId: string;
  runId: string | null;
  transition: ApprovalTransition;
};

const approvalWaitTimeDecisionStatuses = new Set<ApprovalWaitTimeMetricInput["decision"]>([
  "approved",
  "rejected",
  "expired",
  "bypassed",
]);

function isApprovalWaitTimeDecision(
  status: ApprovalStatus,
): status is ApprovalWaitTimeMetricInput["decision"] {
  return approvalWaitTimeDecisionStatuses.has(status as ApprovalWaitTimeMetricInput["decision"]);
}

function recordApprovalWaitTimeSafely(
  recordMetric: (input: ApprovalWaitTimeMetricInput) => void,
  input: ApprovalWaitTimeMetricInput,
): void {
  try {
    recordMetric(input);
  } catch {
    // Approval persistence must not depend on telemetry sink health.
  }
}

export async function applyApprovalTransition(
  input: ApplyApprovalTransitionInput,
): Promise<AppliedApprovalTransition> {
  const occurredAt = input.occurredAt ?? new Date();
  let waitTimeMetric: ApprovalWaitTimeMetricInput | undefined;

  const appliedTransition = await input.database.transaction(async (tx) => {
    const transition = transitionApproval({
      action: input.action,
      actorId: input.actorId,
      currentStatus: input.expectedStatus,
      note: input.note,
      occurredAt,
    });
    const note = transition.note ?? input.note?.trim();

    const [approval] = await tx
      .update(approvals)
      .set({
        status: transition.to,
        resolvedBy: transition.actorId,
        resolvedAt: new Date(transition.occurredAt),
        ...(note ? { note } : {}),
      })
      .where(
        and(
          eq(approvals.id, input.approvalId),
          eq(approvals.status, input.expectedStatus),
          input.action === "apply"
            ? undefined
            : sql`not coalesce(${approvals.metadata} ? 'prWriteClaim', false)`,
        ),
      )
      .returning({
        id: approvals.id,
        requestedAt: approvals.requestedAt,
        runId: approvals.runId,
        scope: approvals.scope,
        status: approvals.status,
      });

    if (!approval) {
      const [currentApproval] = await tx
        .select({
          id: approvals.id,
          metadata: approvals.metadata,
          status: approvals.status,
        })
        .from(approvals)
        .where(eq(approvals.id, input.approvalId))
        .limit(1);

      if (!currentApproval) {
        throw new ApprovalNotFoundError(input.approvalId);
      }

      if (
        currentApproval.status === input.expectedStatus &&
        (currentApproval.metadata as { prWriteClaim?: unknown } | null)?.prWriteClaim
      ) {
        throw new ApprovalWriteInProgressError(input.approvalId);
      }

      throw new ApprovalExpectedStatusError(
        input.approvalId,
        input.expectedStatus,
        currentApproval.status,
      );
    }

    await tx.insert(approvalTransitionEvents).values({
      action: transition.action,
      actorId: transition.actorId,
      approvalId: input.approvalId,
      fromStatus: transition.from,
      metadata: {
        authMode: input.authMode,
        expectedStatus: input.expectedStatus,
      },
      note: transition.note,
      occurredAt: new Date(transition.occurredAt),
      runId: approval.runId,
      toStatus: transition.to,
    });

    input.logger?.info(
      {
        action: transition.action,
        actorId: transition.actorId,
        approvalId: input.approvalId,
        currentStatus: transition.from,
        nextStatus: transition.to,
        runId: approval.runId,
      },
      "approval_transition_persisted",
    );

    if (isApprovalWaitTimeDecision(transition.to)) {
      const requestedAt = new Date(approval.requestedAt).getTime();
      const resolvedAt = new Date(transition.occurredAt).getTime();
      const durationSeconds = Math.max(0, (resolvedAt - requestedAt) / 1000);

      waitTimeMetric = {
        decision: transition.to,
        durationSeconds,
        gate: approval.scope,
      };
    }

    return {
      approvalId: input.approvalId,
      runId: approval.runId,
      transition,
    };
  });

  if (waitTimeMetric) {
    recordApprovalWaitTimeSafely(
      input.recordApprovalWaitTimeMetric ?? recordApprovalWaitTimeMetric,
      waitTimeMetric,
    );
  }

  return appliedTransition;
}
