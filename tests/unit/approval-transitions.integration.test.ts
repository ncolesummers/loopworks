/** @vitest-environment node */

import { createPlanningAgentSeedPlan } from "@agent/planning-agent";
import { eq } from "drizzle-orm";

import { agentPlans, approvals, loopRuns, repositories } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  type DevelopmentLoopTransitionDatabase,
  recordDevelopmentLoopPlanArtifact,
} from "@/lib/loops/development-run-transitions";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../helpers/pglite";

describe("plan-review approval synchronization", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      githubRepoId: 47_000_001,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
      enabledLoops: ["Agent-ready development loop"],
      validationGates: ["Focused tests"],
    });
  });

  afterEach(async () => context.close());

  it("updates the exact agent plan when its durable review is approved", async () => {
    const run = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Test-writing subagent",
      },
    });
    if (run.mode !== "created") throw new Error("Expected created run.");

    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, run.runId));
    const [plan] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, run.runId));
    if (!approval || !plan) throw new Error("Expected plan review fixtures.");

    await applyApprovalTransition({
      action: "approve",
      actorId: "maintainer",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });

    const [updatedPlan] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.id, plan.id));
    expect(updatedPlan?.status).toBe("approved");
  });

  it("marks the plan rejected and blocks the run when its review is bypassed", async () => {
    const run = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Test-writing subagent",
      },
    });
    if (run.mode !== "created") throw new Error("Expected created run.");
    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, run.runId));
    if (!approval) throw new Error("Expected plan review fixture.");

    await applyApprovalTransition({
      action: "bypass",
      actorId: "maintainer",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });

    const [plan] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, run.runId));
    const [blockedRun] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, run.runId));
    expect(plan?.status).toBe("rejected");
    expect(blockedRun?.status).toBe("blocked");
  });

  it("leaves an advanced run untouched when an approved plan review is applied", async () => {
    const run = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Test-writing subagent",
      },
    });
    if (run.mode !== "created") throw new Error("Expected created run.");
    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, run.runId));
    if (!approval) throw new Error("Expected plan review fixture.");

    await applyApprovalTransition({
      action: "approve",
      actorId: "maintainer",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });
    await applyApprovalTransition({
      action: "apply",
      actorId: "loopworks",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "approved",
    });

    const [plan] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, run.runId));
    const [advancedRun] = await context.db
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.id, run.runId));
    expect(plan?.status).toBe("approved");
    expect(advancedRun).toMatchObject({ currentStage: "test-writing", status: "running" });
  });

  it("records a planner-pinned revision before creating the durable review", async () => {
    const run = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        body: "## Acceptance Criteria\n- Planner output is pinned before review.",
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        title: "Test-writing subagent",
      },
    });
    if (run.mode !== "created") throw new Error("Expected created run.");

    const plan = createPlanningAgentSeedPlan({
      body: "## Acceptance Criteria\n- Planner output is pinned before review.",
      issueNumber: 47,
      labels: [],
      milestone: null,
      repositoryFullName: "ncolesummers/loopworks",
      repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
      title: "Test-writing subagent",
    });
    const result = await recordDevelopmentLoopPlanArtifact({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      plan,
      runId: run.runId,
    });

    expect(result.status).toBe("waiting_for_approval");
    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, result.approvalId));
    const [updatedRun] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, run.runId));
    expect(approval).toMatchObject({
      scope: "plan-review",
      status: "requested",
      metadata: { planId: result.planId, planSha256: plan.identity.sha256 },
    });
    expect(updatedRun?.status).toBe("waiting_for_approval");
  });

  it("preserves an existing run start time when recording the plan artifact", async () => {
    const run = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        body: "## Acceptance Criteria\n- Planner output is pinned before review.",
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        title: "Test-writing subagent",
      },
    });
    if (run.mode !== "created") throw new Error("Expected created run.");
    const startedAt = new Date("2026-07-11T15:30:00.000Z");
    await context.db
      .update(loopRuns)
      .set({ startedAt, status: "running" })
      .where(eq(loopRuns.id, run.runId));

    const plan = createPlanningAgentSeedPlan({
      body: "## Acceptance Criteria\n- Planner output is pinned before review.",
      issueNumber: 47,
      labels: [],
      milestone: null,
      repositoryFullName: "ncolesummers/loopworks",
      repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
      title: "Test-writing subagent",
    });
    await recordDevelopmentLoopPlanArtifact({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      plan,
      runId: run.runId,
    });

    const [updatedRun] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, run.runId));
    expect(updatedRun?.startedAt).toEqual(startedAt);
    expect(updatedRun?.status).toBe("waiting_for_approval");
  });
});
