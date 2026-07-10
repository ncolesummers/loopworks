import type { db } from "@/db/client";

export const approvalStatusValues = [
  "requested",
  "approved",
  "rejected",
  "cancelled",
  "expired",
  "applied",
  "bypassed",
] as const;

export const approvalActionValues = [
  "approve",
  "reject",
  "cancel",
  "expire",
  "apply",
  "bypass",
] as const;

export type ApprovalStatus = (typeof approvalStatusValues)[number];
export type ApprovalAction = (typeof approvalActionValues)[number];
export type ApprovalTransitionDatabase = Pick<typeof db, "transaction">;

export type ApprovalTransition = {
  from: ApprovalStatus;
  to: ApprovalStatus;
  action: ApprovalAction;
  actorId: string;
  occurredAt: string;
  note?: string;
};

export class ApprovalTransitionError extends Error {
  constructor(
    public readonly currentStatus: ApprovalStatus,
    public readonly action: ApprovalAction,
  ) {
    super(`Cannot ${action} approval from ${currentStatus}.`);
    this.name = "ApprovalTransitionError";
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval ${approvalId} was not found.`);
    this.name = "ApprovalNotFoundError";
  }
}

export class ApprovalExpectedStatusError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly expectedStatus: ApprovalStatus,
    public readonly actualStatus: ApprovalStatus,
  ) {
    super(`Approval ${approvalId} is ${actualStatus}, not expected status ${expectedStatus}.`);
    this.name = "ApprovalExpectedStatusError";
  }
}

export class ApprovalWriteInProgressError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval ${approvalId} has an external write in progress.`);
    this.name = "ApprovalWriteInProgressError";
  }
}

const approvalTransitionMap: Record<
  ApprovalStatus,
  Partial<Record<ApprovalAction, ApprovalStatus>>
> = {
  requested: {
    approve: "approved",
    reject: "rejected",
    cancel: "cancelled",
    expire: "expired",
    bypass: "bypassed",
  },
  approved: {
    apply: "applied",
    cancel: "cancelled",
    expire: "expired",
  },
  rejected: {},
  cancelled: {},
  expired: {},
  applied: {},
  bypassed: {},
};

export function canTransitionApproval(
  currentStatus: ApprovalStatus,
  action: ApprovalAction,
): boolean {
  return approvalTransitionMap[currentStatus][action] !== undefined;
}

export function transitionApproval(input: {
  currentStatus: ApprovalStatus;
  action: ApprovalAction;
  actorId: string;
  note?: string;
  occurredAt?: Date;
}): ApprovalTransition {
  const nextStatus = approvalTransitionMap[input.currentStatus][input.action];
  if (!nextStatus) {
    throw new ApprovalTransitionError(input.currentStatus, input.action);
  }

  const actorId = input.actorId.trim();
  if (!actorId) {
    throw new Error("Approval transitions require an actorId.");
  }

  const note = input.note?.trim();

  return {
    from: input.currentStatus,
    to: nextStatus,
    action: input.action,
    actorId,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    ...(note ? { note } : {}),
  };
}
