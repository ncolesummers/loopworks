import {
  computePlanningArtifactDigest,
  planningAgentModelLabel,
  planningAgentOutputSchema,
  planningAgentToolContractSchema,
} from "@agent/planning-agent";
import { z } from "zod";
import type { ApprovalPlanRecord } from "@/lib/types";

/** Server-side presentation projection; execution enforcement remains in loop transitions. */
export function projectApprovalPlan(input: {
  content: unknown;
  planId: unknown;
  planSha256: unknown;
  runId?: string | null;
}): ApprovalPlanRecord {
  const id = typeof input.planId === "string" && input.planId.trim() ? input.planId : undefined;
  const validPlanId = z.guid().safeParse(id).success;
  const sha256 =
    typeof input.planSha256 === "string" && input.planSha256.trim() ? input.planSha256 : undefined;
  const base = {
    ...(id ? { id } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(input.content == null ? {} : { content: JSON.stringify(input.content, null, 2) }),
    canReject: Boolean(validPlanId && input.runId),
  };
  const unavailable = (
    reviewability: ApprovalPlanRecord["reviewability"],
    reason: string,
  ): ApprovalPlanRecord => ({ ...base, reviewability, reason });
  if (!validPlanId || !sha256 || !input.runId) {
    return unavailable(
      "unbound",
      "The gate has a missing or invalid plan identity or run binding. Approval is unavailable.",
    );
  }
  if (input.content == null) {
    return unavailable(
      "missing",
      "The bound plan content is unavailable. Approval is unavailable until the plan can be reviewed.",
    );
  }
  const parsed = planningAgentOutputSchema.safeParse(input.content);
  if (!parsed.success) {
    const record =
      typeof input.content === "object" && !Array.isArray(input.content)
        ? (input.content as Record<string, unknown>)
        : undefined;
    if (
      record &&
      ((typeof record.model === "string" && record.model !== planningAgentModelLabel) ||
        (record.toolContractSummary != null &&
          !planningAgentToolContractSchema.safeParse(record.toolContractSummary).success))
    ) {
      return unavailable(
        "unsupported",
        "This plan uses a model or tool contract this review surface does not support. Inspect the original content; approval is unavailable.",
      );
    }
    return unavailable(
      "malformed",
      "The stored plan does not satisfy the planning artifact schema. Inspect the original content; approval is unavailable.",
    );
  }
  const review = parsed.data;
  // The database join binds metadata.planId to agent_plans.id and the run.
  // The artifact's internal identity.id is a different identifier.
  if (review.identity.sha256 !== sha256 || computePlanningArtifactDigest(review) !== sha256) {
    return unavailable(
      "mismatch",
      "The plan identity or content digest does not match the gate's bound plan. Approval is unavailable.",
    );
  }
  if (!review.repositoryRevision) {
    return unavailable(
      "unpinned",
      "The plan has no pinned repository revision. Approval is unavailable because test writing requires a pinned revision.",
    );
  }
  return { ...base, review, reviewability: "ready" };
}
