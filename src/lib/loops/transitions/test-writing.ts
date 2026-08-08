import { randomUUID } from "node:crypto";
import { computePlanningArtifactDigest, planningAgentOutputSchema } from "@agent/planning-agent";
import { verifyTestExecutionReceipt } from "@agent/subagents/test-writer/lib/tool-policy";
import {
  computeTestPlanDigest,
  type TestWritingAgentOutput,
  testWritingAgentOutputSchema,
} from "@agent/test-writing-agent";
import { and, eq, sql } from "drizzle-orm";
import { agentPlans, approvals, artifacts, loopRuns, runSteps } from "@/db/schema";
import { readStringConfig } from "@/lib/config/registry";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";

import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
} from "./shared";

export type TestWritingTransitionResult = {
  idempotent?: boolean;
  runId: string;
  stage: "test-writing";
  status: "advanced";
  stepId: string;
  traceId?: string;
};

export type ApplyDevelopmentLoopTestWritingResultInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  occurredAt?: Date;
  output: TestWritingAgentOutput;
  receiptSecret?: string;
  runId: string;
};

export async function applyDevelopmentLoopTestWritingResult(
  input: ApplyDevelopmentLoopTestWritingResultInput,
): Promise<TestWritingTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const transitionStartedAt = Date.now();
  const output = testWritingAgentOutputSchema.parse(input.output);
  const span = startLoopworksSpan("loopworks.test_writing.transition", {
    attributes: {
      "loopworks.agent": "test-writer",
      "loopworks.run_id": input.runId,
      "loopworks.stage": "test-writing",
      "loopworks.test_count": output.testPlan.tests.length,
      "loopworks.acceptance_criterion_count": output.testPlan.acceptanceCriteria.length,
    },
  });

  try {
    const result = await input.database.transaction<TestWritingTransitionResult>(async (tx) => {
      await assertDevelopmentLoopExecutionLease(tx, input.runId, "test-writing");
      const [run] = await tx.select().from(loopRuns).where(eq(loopRuns.id, input.runId)).limit(1);
      if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

      const [step] = await tx
        .select()
        .from(runSteps)
        .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "test-writing")))
        .limit(1);
      if (!step) {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} does not have a test-writing step.`,
        );
      }
      if (step.status === "succeeded" && step.completedAt) {
        return {
          idempotent: true,
          runId: input.runId,
          stage: "test-writing",
          status: "advanced",
          stepId: step.id,
          ...((step.traceId ?? run.traceId)
            ? { traceId: step.traceId ?? run.traceId ?? undefined }
            : {}),
        } satisfies TestWritingTransitionResult;
      }
      if (run.currentStage !== "test-writing") {
        throw new DevelopmentLoopTransitionError(
          `Run ${input.runId} is at ${run.currentStage}, not test-writing.`,
        );
      }

      const planRows = await tx.select().from(agentPlans).where(eq(agentPlans.runId, input.runId));
      if (planRows.length !== 1) {
        throw new DevelopmentLoopTransitionError("Test writing requires exactly one current plan.");
      }
      const planRow = planRows[0];
      const parsedPlan = planningAgentOutputSchema.safeParse(planRow?.plan);
      if (!planRow || !parsedPlan.success || !parsedPlan.data.repositoryRevision) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires a pinned planning artifact.",
        );
      }
      const plan = parsedPlan.data;
      const repositoryRevision = plan.repositoryRevision;
      if (!repositoryRevision) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires a pinned repository revision.",
        );
      }
      if (
        plan.identity.sha256 !== computePlanningArtifactDigest(plan) ||
        plan.identity.id !== output.testPlan.plan.id ||
        plan.identity.sha256 !== output.testPlan.plan.sha256 ||
        plan.issue.repositoryFullName !== output.testPlan.plan.repositoryFullName ||
        repositoryRevision.commitSha !== output.testPlan.plan.commitSha
      ) {
        throw new DevelopmentLoopTransitionError(
          "Test-writing output does not match the persisted plan.",
        );
      }

      const planApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
      if (planApprovals.length !== 1) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires exactly one current plan-review approval.",
        );
      }
      const approval = planApprovals[0];
      const approvalMetadata = approval?.metadata;
      if (
        approval?.status !== "approved" ||
        approvalMetadata?.planId !== planRow.id ||
        approvalMetadata?.planSha256 !== plan.identity.sha256
      ) {
        throw new DevelopmentLoopTransitionError(
          "Test writing requires an approved plan-review bound to the exact plan.",
        );
      }

      const expectedCriteria = plan.issue.acceptanceCriteria.map((text, index) => ({
        id: `ac-${index + 1}`,
        text,
      }));
      if (JSON.stringify(output.testPlan.acceptanceCriteria) !== JSON.stringify(expectedCriteria)) {
        throw new DevelopmentLoopTransitionError(
          "Test plan acceptance criteria do not exactly match the approved plan.",
        );
      }

      const receiptSecret =
        input.receiptSecret ?? readStringConfig("LOOPWORKS_EVE_TEST_RECEIPT_SECRET");
      if (!receiptSecret) {
        throw new DevelopmentLoopTransitionError(
          "Test execution receipt verification is not configured.",
        );
      }
      for (const result of output.redEvidence.results) {
        const test = output.testPlan.tests.find(({ id }) => id === result.testId);
        if (
          !test ||
          !verifyTestExecutionReceipt(
            {
              command: result.command,
              exitCode: result.exitCode,
              expectedAssertions: [result.expectedAssertion],
              outcome: result.outcome,
              outputSha256: result.outputReference.sha256,
              patchSha256: output.testPlan.patch.sha256,
              planSha256: plan.identity.sha256,
              testPaths: [test.path],
            },
            result.executionReceipt,
            receiptSecret,
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            `Red evidence receipt is invalid for test ${result.testId}.`,
          );
        }
      }

      const claimId = randomUUID();
      const [claimedStep] = await tx
        .update(runSteps)
        .set({ metadata: { ...(step.metadata ?? {}), testWritingClaim: claimId } })
        .where(
          and(
            eq(runSteps.id, step.id),
            sql`not coalesce(${runSteps.metadata} ? 'testWritingClaim', false)`,
          ),
        )
        .returning({ id: runSteps.id });
      if (!claimedStep) {
        throw new DevelopmentLoopTransitionError(
          `Test-writing transition is already in progress for run ${input.runId}.`,
        );
      }

      const stageArtifacts = await tx
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.runId, input.runId), eq(artifacts.stepId, step.id)));
      const redArtifact = stageArtifacts.find((artifact) => artifact.type === "validation_report");
      const testPlanArtifact = stageArtifacts.find((artifact) => artifact.type === "test_plan");
      if (!redArtifact || !testPlanArtifact) {
        throw new DevelopmentLoopTransitionError(
          "Test-writing step requires validation_report and test_plan artifacts.",
        );
      }

      await tx
        .update(artifacts)
        .set({
          metadata: {
            redTestEvidence: output.redEvidence,
            redTestEvidenceMetadataKind: "red_test_evidence_result",
            redTestEvidenceSchemaId: output.redEvidence.schemaId,
            redTestEvidenceVersion: output.redEvidence.version,
          },
          sha256: computeTestPlanDigest(output.redEvidence),
        })
        .where(eq(artifacts.id, redArtifact.id));
      await tx
        .update(artifacts)
        .set({
          metadata: {
            testPlan: output.testPlan,
            testPlanMetadataKind: "test_plan_result",
            testPlanSchemaId: output.testPlan.schemaId,
            testPlanVersion: output.testPlan.version,
          },
          sha256: computeTestPlanDigest(output.testPlan),
        })
        .where(eq(artifacts.id, testPlanArtifact.id));

      const startedAt = step.startedAt ?? occurredAt;
      await tx
        .update(runSteps)
        .set({
          completedAt: occurredAt,
          startedAt,
          status: "succeeded",
          validationStatus: "red",
        })
        .where(eq(runSteps.id, step.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "development",
          startedAt: run.startedAt ?? run.queuedAt,
          status: "running",
        })
        .where(eq(loopRuns.id, input.runId));

      input.logger?.info(
        {
          acceptanceCriterionCount: output.testPlan.acceptanceCriteria.length,
          durationMs: Math.max(0, Date.now() - transitionStartedAt),
          outcome: "advanced",
          planSha256: plan.identity.sha256,
          runId: input.runId,
          stepId: step.id,
          testCount: output.testPlan.tests.length,
        },
        "test_writing_stage_advanced",
      );

      return {
        runId: input.runId,
        stage: "test-writing",
        status: "advanced",
        stepId: step.id,
        ...((step.traceId ?? run.traceId)
          ? { traceId: step.traceId ?? run.traceId ?? undefined }
          : {}),
      } satisfies TestWritingTransitionResult;
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.outcome": "advanced",
    });
    markLoopworksSpanOk(span);
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}
