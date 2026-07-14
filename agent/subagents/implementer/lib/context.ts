import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentPlans, approvals, artifacts, loopRuns, runSteps } from "@/db/schema";
import { createImplementationFixtureHandoff } from "../../../implementation-fixture";
import { computePlanningArtifactDigest, planningAgentOutputSchema } from "../../../planning-agent";
import {
  computeTestPlanDigest,
  redTestEvidenceSchema,
  testPlanArtifactSchema,
} from "../../../test-writing-agent";
import { resolveImplementerFixtureMode } from "./fixture-mode";

export async function loadImplementationHandoff(runId: string) {
  if (resolveImplementerFixtureMode().enabled) return createImplementationFixtureHandoff();

  const [run] = await db.select().from(loopRuns).where(eq(loopRuns.id, runId));
  if (run?.currentStage !== "development") {
    throw new Error("Run is not available for implementation.");
  }
  const [planRows, planApprovals, steps] = await Promise.all([
    db.select().from(agentPlans).where(eq(agentPlans.runId, runId)),
    db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "plan-review"))),
    db.select().from(runSteps).where(eq(runSteps.runId, runId)),
  ]);
  if (planRows.length !== 1 || planApprovals.length !== 1) {
    throw new Error("Implementation requires exactly one plan and plan review.");
  }
  const planRow = planRows[0];
  const approval = planApprovals[0];
  const plan = planningAgentOutputSchema.parse(planRow?.plan);
  if (
    planRow?.status !== "approved" ||
    approval?.status !== "approved" ||
    approval.metadata?.planId !== planRow.id ||
    approval.metadata?.planSha256 !== plan.identity.sha256 ||
    !plan.repositoryRevision ||
    computePlanningArtifactDigest(plan) !== plan.identity.sha256
  ) {
    throw new Error("Implementation requires an exact approved pinned plan.");
  }
  const testStep = steps.find(({ stage }) => stage === "test-writing");
  const developmentStep = steps.find(({ stage }) => stage === "development");
  if (testStep?.status !== "succeeded" || !developmentStep) {
    throw new Error("Implementation requires a completed test-writing handoff.");
  }
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.runId, runId), eq(artifacts.stepId, testStep.id)));
  const testPlanRow = rows.find(({ type }) => type === "test_plan");
  const redRow = rows.find(({ type }) => type === "validation_report");
  const testPlan = testPlanArtifactSchema.parse(testPlanRow?.metadata?.testPlan);
  const redEvidence = redTestEvidenceSchema.parse(redRow?.metadata?.redTestEvidence);
  if (
    testPlanRow?.sha256 !== computeTestPlanDigest(testPlan) ||
    redRow?.sha256 !== computeTestPlanDigest(redEvidence) ||
    redEvidence.testPlanSha256 !== computeTestPlanDigest(testPlan) ||
    testPlan.plan.id !== plan.identity.id ||
    testPlan.plan.sha256 !== plan.identity.sha256 ||
    testPlan.plan.commitSha !== plan.repositoryRevision.commitSha
  ) {
    throw new Error("Implementation handoff artifacts are stale or mismatched.");
  }
  return { plan, redEvidence, testPlan };
}
