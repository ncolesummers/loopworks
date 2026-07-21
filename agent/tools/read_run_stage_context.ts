import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { agentPlans, approvals, artifacts, loopRuns, runSteps } from "@/db/schema";
import { createImplementationFixtureHandoff } from "../implementation-fixture";
import { createPlanningAgentSeedPlan } from "../planning-agent";
import { resolveImplementerFixtureMode } from "../subagents/implementer/lib/fixture-mode";
import { resolvePrPreparerFixtureMode } from "../subagents/pr-preparer/lib/fixture-mode";
import { resolveTestWriterFixtureMode } from "../subagents/test-writer/lib/fixture-mode";
import { resolveValidationReviewerFixtureMode } from "../subagents/validation-reviewer/lib/fixture-mode";
import { computeTestPlanDigest } from "../test-writing-agent";
import { createValidationReviewFixtureContext } from "../validation-review-fixture";
import { createPrPreparationFixtureContext } from "../pr-preparation-fixture";

export default defineTool({
  description: "Read durable run, plan, approval, step, and artifact context for stage routing.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }) {
    if (resolvePrPreparerFixtureMode().enabled) {
      const context = createPrPreparationFixtureContext();
      return {
        approvals: [{ id: "fixture-plan-approval", status: context.approvalStatus }],
        artifacts: context.completedArtifacts.map((artifact) => ({
          type: artifact.type,
          sha256: artifact.sha256,
          uri: artifact.uri,
        })),
        plans: [{ id: context.planId, plan: context.plan, status: context.planStatus }],
        run: context.run,
        steps: [
          { ...context.validationStep, stage: "validation" },
          { ...context.reviewStep, stage: "code-review" },
          { ...context.commitStep, stage: "commit" },
          { ...context.prStep, stage: "pr" },
        ],
      };
    }
    if (resolveValidationReviewerFixtureMode().enabled) {
      const context = createValidationReviewFixtureContext();
      return {
        approvals: [{ id: "fixture-plan-approval", status: context.approvalStatus }],
        artifacts: [
          {
            type: "test_plan",
            metadata: { testPlan: context.testPlan },
            sha256: context.testPlanArtifactSha256,
          },
          {
            type: "patch",
            metadata: { implementationResult: context.implementationResult },
            sha256: context.implementationArtifactSha256,
          },
          {
            type: "validation_report",
            metadata: { validationReport: context.validationReport },
            sha256: context.validationArtifactSha256,
          },
          {
            type: "screenshot",
            metadata: { screenshotEvidence: context.screenshotEvidence },
            sha256: context.screenshotArtifactSha256,
          },
        ],
        plans: [{ id: context.plan.identity.id, plan: context.plan, status: context.planStatus }],
        run: context.run,
        steps: [context.validationStep, { ...context.reviewStep, stage: "code-review" }],
      };
    }
    if (resolveImplementerFixtureMode().enabled) {
      const { plan, redEvidence, testPlan } = createImplementationFixtureHandoff();
      const planId = "00000000-0000-4000-8000-000000000148";
      return {
        approvals: [
          {
            id: "00000000-0000-4000-8000-000000000248",
            metadata: { planId, planSha256: plan.identity.sha256 },
            status: "approved",
          },
        ],
        artifacts: [
          {
            id: "00000000-0000-4000-8000-000000000448",
            metadata: { testPlan, testPlanMetadataKind: "test_plan_result" },
            sha256: computeTestPlanDigest(testPlan),
            stepId: "00000000-0000-4000-8000-000000000347",
            type: "test_plan",
            uri: "artifact://fixture/test-plan",
          },
          {
            id: "00000000-0000-4000-8000-000000000548",
            metadata: {
              redTestEvidence: redEvidence,
              redTestEvidenceMetadataKind: "red_test_evidence_result",
            },
            sha256: computeTestPlanDigest(redEvidence),
            stepId: "00000000-0000-4000-8000-000000000347",
            type: "validation_report",
            uri: "artifact://fixture/red-evidence",
          },
        ],
        plans: [{ id: planId, plan, status: "approved" }],
        run: { currentStage: "development", id: runId, status: "running" },
        steps: [
          {
            id: "00000000-0000-4000-8000-000000000347",
            stage: "test-writing",
            status: "succeeded",
          },
          {
            id: "00000000-0000-4000-8000-000000000348",
            stage: "development",
            status: "running",
          },
        ],
      };
    }
    if (resolveTestWriterFixtureMode().enabled) {
      const planId = "00000000-0000-4000-8000-000000000147";
      const plan = createPlanningAgentSeedPlan({
        body: [
          "## Acceptance Criteria",
          "- Red evidence is tied to the plan acceptance criteria.",
          "- The automated test plan and fixture data are reusable downstream.",
          "- Future model, prompt, and tool changes have eval coverage.",
          "- ADR 0015 records the orchestrator, sibling subagents, isolated sandboxes, and artifact handoff.",
        ].join("\n"),
        issueNumber: 47,
        labels: ["area:agents"],
        milestone: null,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
        title: "Test-writing subagent for the development loop",
      });
      return {
        approvals: [
          {
            id: "00000000-0000-4000-8000-000000000247",
            metadata: { planId, planSha256: plan.identity.sha256 },
            status: "approved",
          },
        ],
        artifacts: [],
        plans: [{ id: planId, plan, status: "approved" }],
        run: { currentStage: "test-writing", id: runId, status: "running" },
        steps: [
          {
            id: "00000000-0000-4000-8000-000000000347",
            stage: "test-writing",
            status: "queued",
          },
        ],
      };
    }
    const [run] = await db.select().from(loopRuns).where(eq(loopRuns.id, runId)).limit(1);
    if (!run) throw new Error(`Run ${runId} was not found.`);
    const [steps, plans, planApprovals, runArtifacts] = await Promise.all([
      db.select().from(runSteps).where(eq(runSteps.runId, runId)),
      db.select().from(agentPlans).where(eq(agentPlans.runId, runId)),
      db
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, runId), eq(approvals.scope, "plan-review"))),
      db.select().from(artifacts).where(eq(artifacts.runId, runId)),
    ]);
    return {
      run: { currentStage: run.currentStage, id: run.id, status: run.status },
      steps: steps.map(({ id, stage, status }) => ({ id, stage, status })),
      plans: plans.map(({ id, plan, status }) => ({ id, plan, status })),
      approvals: planApprovals.map(({ id, metadata, status }) => ({ id, metadata, status })),
      artifacts: runArtifacts.map(({ id, metadata, sha256, stepId, type, uri }) => ({
        id,
        metadata,
        sha256,
        stepId,
        type,
        uri,
      })),
    };
  },
});
