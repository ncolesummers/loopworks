import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/auth/api";
import { db } from "@/db/client";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import {
  ApprovalExpectedStatusError,
  ApprovalNotFoundError,
  ApprovalTransitionError,
  approvalActionValues,
  approvalStatusValues,
  type ApprovalTransitionDatabase,
} from "@/lib/approvals";
import { createRequestLogger } from "@/lib/observability/logger";

const approvalTransitionRequestSchema = z.object({
  approvalId: z.uuid(),
  expectedStatus: z.enum(approvalStatusValues),
  action: z.enum(approvalActionValues),
  note: z.string().min(1).optional(),
});

export const runtime = "nodejs";

export async function handleApprovalTransitionPost(
  request: Request,
  dependencies: {
    database?: ApprovalTransitionDatabase;
    now?: () => Date;
  } = {},
) {
  const requestLogger = createRequestLogger({
    route: "api.approvals.transition",
  });
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? (() => new Date());
  const apiSession = await requireApiSession({
    route: "api.approvals.transition",
    logger: requestLogger,
  });
  if (!apiSession.authenticated) {
    return apiSession.response;
  }

  let requestBody: unknown;
  try {
    requestBody = (await request.json()) as unknown;
  } catch {
    requestLogger.warn("approval_transition_invalid_json");
    return NextResponse.json(
      {
        error: "Approval transition requests must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const body = approvalTransitionRequestSchema.safeParse(requestBody);
  if (!body.success) {
    requestLogger.warn(
      {
        issues: body.error.issues,
      },
      "approval_transition_validation_failed",
    );
    return NextResponse.json(
      {
        error: "Invalid approval transition request.",
        issues: body.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await applyApprovalTransition({
      action: body.data.action,
      approvalId: body.data.approvalId,
      actorId: apiSession.actorId,
      authMode: apiSession.mode,
      database,
      expectedStatus: body.data.expectedStatus,
      logger: requestLogger,
      note: body.data.note,
      occurredAt: now(),
    });
    requestLogger.info(
      {
        approvalId: body.data.approvalId,
        action: body.data.action,
        actorId: apiSession.actorId,
        authMode: apiSession.mode,
        currentStatus: result.transition.from,
        nextStatus: result.transition.to,
        runId: result.runId,
      },
      "approval_transition_applied",
    );
    return NextResponse.json(
      {
        approvalId: result.approvalId,
        runId: result.runId,
        transition: result.transition,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ApprovalNotFoundError) {
      requestLogger.warn(
        {
          approvalId: error.approvalId,
        },
        "approval_transition_not_found",
      );
      return NextResponse.json(
        {
          error: error.message,
          approvalId: error.approvalId,
        },
        { status: 404 },
      );
    }

    if (error instanceof ApprovalExpectedStatusError) {
      requestLogger.warn(
        {
          actualStatus: error.actualStatus,
          approvalId: error.approvalId,
          expectedStatus: error.expectedStatus,
        },
        "approval_transition_stale_state",
      );
      return NextResponse.json(
        {
          error: error.message,
          actualStatus: error.actualStatus,
          approvalId: error.approvalId,
          expectedStatus: error.expectedStatus,
        },
        { status: 409 },
      );
    }

    if (error instanceof ApprovalTransitionError) {
      requestLogger.warn(
        {
          action: error.action,
          currentStatus: error.currentStatus,
        },
        "approval_transition_rejected",
      );
      return NextResponse.json(
        {
          error: error.message,
          currentStatus: error.currentStatus,
          action: error.action,
        },
        { status: 409 },
      );
    }

    throw error;
  }
}

export async function POST(request: Request) {
  return handleApprovalTransitionPost(request);
}
