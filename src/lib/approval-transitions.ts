import { and, eq } from "drizzle-orm";

import { approvalTransitionEvents, approvals } from "@/db/schema";
import {
  ApprovalExpectedStatusError,
  ApprovalNotFoundError,
  type ApprovalAction,
  type ApprovalStatus,
  type ApprovalTransition,
  type ApprovalTransitionDatabase,
  transitionApproval,
} from "@/lib/approvals";
import type { LoopworksLogger } from "@/lib/observability/logger";

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
};

export type AppliedApprovalTransition = {
  approvalId: string;
  runId: string | null;
  transition: ApprovalTransition;
};

export async function applyApprovalTransition(
  input: ApplyApprovalTransitionInput,
): Promise<AppliedApprovalTransition> {
  const occurredAt = input.occurredAt ?? new Date();

  return input.database.transaction(async (tx) => {
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
      .where(and(eq(approvals.id, input.approvalId), eq(approvals.status, input.expectedStatus)))
      .returning({
        id: approvals.id,
        runId: approvals.runId,
        status: approvals.status,
      });

    if (!approval) {
      const [currentApproval] = await tx
        .select({
          id: approvals.id,
          status: approvals.status,
        })
        .from(approvals)
        .where(eq(approvals.id, input.approvalId))
        .limit(1);

      if (!currentApproval) {
        throw new ApprovalNotFoundError(input.approvalId);
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

    return {
      approvalId: input.approvalId,
      runId: approval.runId,
      transition,
    };
  });
}
