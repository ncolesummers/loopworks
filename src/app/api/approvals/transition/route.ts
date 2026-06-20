import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiSession } from "@/lib/auth/api";
import {
  ApprovalTransitionError,
  approvalActionValues,
  approvalStatusValues,
  transitionApproval,
} from "@/lib/approvals";
import { createRequestLogger } from "@/lib/observability/logger";

const approvalTransitionRequestSchema = z.object({
  currentStatus: z.enum(approvalStatusValues),
  action: z.enum(approvalActionValues),
  note: z.string().min(1).optional(),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestLogger = createRequestLogger({
    route: "api.approvals.transition",
  });
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
    const transition = transitionApproval({
      ...body.data,
      actorId: apiSession.actorId,
    });
    requestLogger.info(
      {
        action: body.data.action,
        actorId: apiSession.actorId,
        authMode: apiSession.mode,
        currentStatus: body.data.currentStatus,
        nextStatus: transition.to,
      },
      "approval_transition_applied",
    );
    return NextResponse.json(
      {
        transition,
      },
      { status: 200 },
    );
  } catch (error) {
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
