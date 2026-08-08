import { randomUUID } from "node:crypto";
import {
  computePlanningArtifactDigest,
  pinnedPlanningAgentOutputSchema,
} from "@agent/planning-agent";
import { and, eq } from "drizzle-orm";
import { agentPlans, approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";

import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
} from "./shared";

export type RecordDevelopmentLoopPlanArtifactInput = {
  database: DevelopmentLoopTransitionDatabase;
  occurredAt?: Date;
  plan: unknown;
  runId: string;
};

export async function recordDevelopmentLoopPlanArtifact(
  input: RecordDevelopmentLoopPlanArtifactInput,
): Promise<{ approvalId: string; planId: string; runId: string; status: "waiting_for_approval" }> {
  const plan = pinnedPlanningAgentOutputSchema.parse(input.plan);
  if (!plan.repositoryRevision || computePlanningArtifactDigest(plan) !== plan.identity.sha256) {
    throw new DevelopmentLoopTransitionError(
      "Plan review requires a valid digest and pinned repository revision.",
    );
  }
  const occurredAt = input.occurredAt ?? new Date();

  return input.database.transaction(async (tx) => {
    await assertDevelopmentLoopExecutionLease(tx, input.runId, "planning");
    const [run] = await tx
      .select({
        currentStage: loopRuns.currentStage,
        id: loopRuns.id,
        queuedAt: loopRuns.queuedAt,
        repositoryFullName: repositories.fullName,
        startedAt: loopRuns.startedAt,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);
    if (run?.currentStage !== "planning") {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} is not available for planning.`);
    }
    if (plan.issue.repositoryFullName !== run.repositoryFullName) {
      throw new DevelopmentLoopTransitionError("Plan repository does not match the run.");
    }

    const [planRow] = await tx
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, input.runId))
      .limit(1);
    const [planningStep] = await tx
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "planning")))
      .limit(1);
    if (!planRow || !planningStep) {
      throw new DevelopmentLoopTransitionError("Run is missing its planning records.");
    }

    await tx
      .update(agentPlans)
      .set({ agentName: "planner", plan, status: "requested" })
      .where(eq(agentPlans.id, planRow.id));

    const [existingApproval] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")))
      .limit(1);
    if (existingApproval && existingApproval.status !== "requested") {
      throw new DevelopmentLoopTransitionError(
        "A resolved plan review cannot be rebound to a new plan.",
      );
    }
    const approvalMetadata = {
      planId: planRow.id,
      planSha256: plan.identity.sha256,
    };
    const approvalId = existingApproval?.id ?? randomUUID();
    if (existingApproval) {
      await tx
        .update(approvals)
        .set({ metadata: approvalMetadata, requestedBy: "planner" })
        .where(eq(approvals.id, existingApproval.id));
    } else {
      await tx.insert(approvals).values({
        id: approvalId,
        metadata: approvalMetadata,
        requestedBy: "planner",
        runId: input.runId,
        scope: "plan-review",
        status: "requested",
      });
    }

    const [planArtifact] = await tx
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, input.runId),
          eq(artifacts.stepId, planningStep.id),
          eq(artifacts.type, "plan"),
        ),
      )
      .limit(1);
    if (!planArtifact) throw new DevelopmentLoopTransitionError("Planning artifact is missing.");
    await tx
      .update(artifacts)
      .set({
        metadata: {
          plan,
          planId: plan.identity.id,
          planMetadataKind: "plan_result",
          planSha256: plan.identity.sha256,
        },
        sha256: plan.identity.sha256,
      })
      .where(eq(artifacts.id, planArtifact.id));
    await tx
      .update(runSteps)
      .set({
        completedAt: occurredAt,
        startedAt: planningStep.startedAt ?? occurredAt,
        status: "succeeded",
      })
      .where(eq(runSteps.id, planningStep.id));
    await tx
      .update(loopRuns)
      .set({ startedAt: run.startedAt ?? run.queuedAt, status: "waiting_for_approval" })
      .where(eq(loopRuns.id, input.runId));

    return { approvalId, planId: planRow.id, runId: input.runId, status: "waiting_for_approval" };
  });
}
