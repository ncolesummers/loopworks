import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentPlans, approvals, artifacts, loopRuns, runSteps } from "@/db/schema";
import { createImplementationFixtureHandoff } from "../../../implementation-fixture";
import { computePlanningArtifactDigest, planningAgentOutputSchema } from "../../../planning-agent";
import {
  computeTestPlanDigest,
  redTestEvidenceSchema,
  testPlanArtifactSchema,
  testWriterModelLabel,
  testWritingAgentOutputSchema,
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
  // Verification must stay at parity with applyDevelopmentLoopImplementationResult:
  // anything the root rejects, the subagent must reject before burning the stage.
  const testPlanRows = rows.filter(({ type }) => type === "test_plan");
  const redRows = rows.filter(({ type }) => type === "validation_report");
  if (testPlanRows.length !== 1 || redRows.length !== 1) {
    throw new Error("Implementation requires exactly one test plan and red-evidence artifact.");
  }
  const testPlanRow = testPlanRows[0];
  const redRow = redRows[0];
  const testPlan = testPlanArtifactSchema.parse(testPlanRow?.metadata?.testPlan);
  const redEvidence = redTestEvidenceSchema.parse(redRow?.metadata?.redTestEvidence);
  const compositeHandoff = testWritingAgentOutputSchema.safeParse({
    model: testWriterModelLabel,
    testPlan,
    redEvidence,
  });
  if (
    !compositeHandoff.success ||
    testPlanRow?.sha256 !== computeTestPlanDigest(testPlan) ||
    redRow?.sha256 !== computeTestPlanDigest(redEvidence) ||
    redEvidence.testPlanSha256 !== computeTestPlanDigest(testPlan) ||
    redEvidence.planId !== plan.identity.id ||
    redEvidence.planSha256 !== plan.identity.sha256 ||
    testPlan.plan.id !== plan.identity.id ||
    testPlan.plan.sha256 !== plan.identity.sha256 ||
    testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
    testPlan.plan.commitSha !== plan.repositoryRevision.commitSha
  ) {
    throw new Error("Implementation handoff artifacts are stale or mismatched.");
  }
  return { plan, redEvidence, testPlan };
}
