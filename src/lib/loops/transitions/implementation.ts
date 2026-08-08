import { randomUUID } from "node:crypto";
import {
  computeImplementationDigest,
  type ImplementationResult,
  implementationResultSchema,
} from "@agent/implementation-agent";
import { computePlanningArtifactDigest, planningAgentOutputSchema } from "@agent/planning-agent";
import { verifyImplementationExecutionReceipt } from "@agent/subagents/implementer/lib/tool-policy";
import {
  computeTestPlanDigest,
  redTestEvidenceSchema,
  testPlanArtifactSchema,
  testWriterModelLabel,
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

export type ImplementationTransitionResult = {
  idempotent?: boolean;
  runId: string;
  stage: "development";
  status: "advanced";
  stepId: string;
  traceId?: string;
};

export type ApplyDevelopmentLoopImplementationResultInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  occurredAt?: Date;
  output: ImplementationResult;
  receiptSecret?: string;
  runId: string;
};

export async function applyDevelopmentLoopImplementationResult(
  input: ApplyDevelopmentLoopImplementationResultInput,
): Promise<ImplementationTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const startedAt = Date.now();
  const output = implementationResultSchema.parse(input.output);
  const span = startLoopworksSpan("loopworks.implementation.transition", {
    attributes: {
      "loopworks.agent": "implementer",
      "loopworks.run_id": input.runId,
      "loopworks.stage": "development",
      "loopworks.test_count": output.greenEvidence.length,
    },
  });

  try {
    const result = await input.database.transaction<ImplementationTransitionResult>(async (tx) => {
      await assertDevelopmentLoopExecutionLease(tx, input.runId, "development");
      const [run] = await tx.select().from(loopRuns).where(eq(loopRuns.id, input.runId)).limit(1);
      if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

      const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
      const step = steps.find(({ stage }) => stage === "development");
      const testWritingStep = steps.find(({ stage }) => stage === "test-writing");
      if (!step || !testWritingStep) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires development and test-writing steps.",
        );
      }
      if (step.status === "succeeded" && step.completedAt) {
        const [persistedArtifact] = await tx
          .select()
          .from(artifacts)
          .where(
            and(
              eq(artifacts.runId, input.runId),
              eq(artifacts.stepId, step.id),
              eq(artifacts.type, "patch"),
            ),
          );
        if (persistedArtifact?.sha256 !== computeImplementationDigest(output)) {
          throw new DevelopmentLoopTransitionError(
            "Idempotent implementation replay does not match the persisted result.",
          );
        }
        return {
          idempotent: true,
          runId: input.runId,
          stage: "development",
          status: "advanced",
          stepId: step.id,
          ...((step.traceId ?? run.traceId)
            ? { traceId: step.traceId ?? run.traceId ?? undefined }
            : {}),
        };
      }
      if (run.currentStage !== "development" || testWritingStep.status !== "succeeded") {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires completed test writing and the development stage.",
        );
      }

      const planRows = await tx.select().from(agentPlans).where(eq(agentPlans.runId, input.runId));
      if (planRows.length !== 1) {
        throw new DevelopmentLoopTransitionError("Implementation requires exactly one plan.");
      }
      const planRow = planRows[0];
      const plan = planningAgentOutputSchema.parse(planRow?.plan);
      const planApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
      const approval = planApprovals[0];
      if (
        planRow?.status !== "approved" ||
        planApprovals.length !== 1 ||
        approval?.status !== "approved" ||
        approval.metadata?.planId !== planRow.id ||
        approval.metadata?.planSha256 !== plan.identity.sha256 ||
        !plan.repositoryRevision ||
        computePlanningArtifactDigest(plan) !== plan.identity.sha256
      ) {
        throw new DevelopmentLoopTransitionError("Implementation plan identity is invalid.");
      }

      const upstreamArtifacts = await tx
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.runId, input.runId), eq(artifacts.stepId, testWritingStep.id)));
      const testPlanRows = upstreamArtifacts.filter(({ type }) => type === "test_plan");
      const redRows = upstreamArtifacts.filter(({ type }) => type === "validation_report");
      if (testPlanRows.length !== 1 || redRows.length !== 1) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires exactly one test plan and red-evidence artifact.",
        );
      }
      const testPlanRow = testPlanRows[0];
      const redRow = redRows[0];
      const testPlanParsed = testPlanArtifactSchema.safeParse(testPlanRow?.metadata?.testPlan);
      const redParsed = redTestEvidenceSchema.safeParse(redRow?.metadata?.redTestEvidence);
      if (!testPlanRow || !redRow || !testPlanParsed.success || !redParsed.success) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires valid persisted test-plan and red-evidence artifacts.",
        );
      }
      const testPlan = testPlanParsed.data;
      const redEvidence = redParsed.data;
      const compositeHandoff = testWritingAgentOutputSchema.safeParse({
        model: testWriterModelLabel,
        testPlan,
        redEvidence,
      });
      if (!compositeHandoff.success) {
        throw new DevelopmentLoopTransitionError(
          "Persisted red evidence does not match the persisted test plan.",
        );
      }
      const testPlanSha256 = computeTestPlanDigest(testPlan);
      if (
        testPlanRow.sha256 !== testPlanSha256 ||
        redRow.sha256 !== computeTestPlanDigest(redEvidence) ||
        redEvidence.testPlanSha256 !== testPlanSha256 ||
        redEvidence.planId !== plan.identity.id ||
        redEvidence.planSha256 !== plan.identity.sha256 ||
        testPlan.plan.id !== plan.identity.id ||
        testPlan.plan.sha256 !== plan.identity.sha256 ||
        testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
        testPlan.plan.commitSha !== plan.repositoryRevision.commitSha
      ) {
        throw new DevelopmentLoopTransitionError("Implementation input artifacts are stale.");
      }

      const expectedBinding = {
        planId: plan.identity.id,
        planSha256: plan.identity.sha256,
        testPlanSha256,
        testPatchSha256: testPlan.patch.sha256,
        fixturesSha256: computeImplementationDigest(testPlan.fixtures),
        repositoryFullName: plan.issue.repositoryFullName,
        commitSha: plan.repositoryRevision.commitSha,
      };
      if (JSON.stringify(output.binding) !== JSON.stringify(expectedBinding)) {
        throw new DevelopmentLoopTransitionError(
          "Implementation result is not bound to the persisted handoff.",
        );
      }
      if (output.greenEvidence.length !== testPlan.tests.length) {
        throw new DevelopmentLoopTransitionError(
          "Implementation requires one green result for every planned test.",
        );
      }

      const receiptSecret =
        input.receiptSecret ?? readStringConfig("LOOPWORKS_EVE_TEST_RECEIPT_SECRET");
      if (!receiptSecret) {
        throw new DevelopmentLoopTransitionError(
          "Implementation execution receipt verification is not configured.",
        );
      }
      for (const plannedTest of testPlan.tests) {
        const evidence = output.greenEvidence.find(({ testId }) => testId === plannedTest.id);
        if (
          !evidence ||
          evidence.command !== plannedTest.command ||
          evidence.testPath !== plannedTest.path ||
          JSON.stringify(evidence.acceptanceCriterionIds) !==
            JSON.stringify(plannedTest.acceptanceCriterionIds) ||
          !verifyImplementationExecutionReceipt(
            {
              kind: "focused",
              command: evidence.command,
              exitCode: evidence.exitCode,
              outcome: evidence.outcome,
              outputSha256: evidence.outputReference.sha256,
              planSha256: output.binding.planSha256,
              testPlanSha256: output.binding.testPlanSha256,
              testPatchSha256: output.binding.testPatchSha256,
              productionPatchSha256: output.patch.sha256,
              testPaths: [evidence.testPath],
            },
            evidence.executionReceipt,
            receiptSecret,
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            `Invalid green implementation evidence for ${plannedTest.id}.`,
          );
        }
      }
      const validation = output.validationEvidence;
      if (
        !verifyImplementationExecutionReceipt(
          {
            kind: "aggregate",
            command: validation.command,
            exitCode: validation.exitCode,
            outcome: validation.outcome,
            outputSha256: validation.outputReference.sha256,
            planSha256: output.binding.planSha256,
            testPlanSha256: output.binding.testPlanSha256,
            testPatchSha256: output.binding.testPatchSha256,
            productionPatchSha256: output.patch.sha256,
            testPaths: [],
          },
          validation.executionReceipt,
          receiptSecret,
        )
      ) {
        throw new DevelopmentLoopTransitionError("Aggregate validation receipt is invalid.");
      }

      const claimId = randomUUID();
      const [claimedStep] = await tx
        .update(runSteps)
        .set({ metadata: { ...(step.metadata ?? {}), implementationClaim: claimId } })
        .where(
          and(
            eq(runSteps.id, step.id),
            sql`not coalesce(${runSteps.metadata} ? 'implementationClaim', false)`,
          ),
        )
        .returning({ id: runSteps.id });
      if (!claimedStep) {
        throw new DevelopmentLoopTransitionError(
          `Implementation transition is already in progress for run ${input.runId}.`,
        );
      }

      const [patchArtifact] = await tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.runId, input.runId),
            eq(artifacts.stepId, step.id),
            eq(artifacts.type, "patch"),
          ),
        );
      if (!patchArtifact) {
        throw new DevelopmentLoopTransitionError("Development patch artifact is missing.");
      }
      await tx
        .update(artifacts)
        .set({
          metadata: {
            implementationMetadataKind: "implementation_result",
            implementationResult: output,
            implementationResultSchemaId: output.schemaId,
            implementationVersion: output.version,
          },
          sha256: computeImplementationDigest(output),
        })
        .where(eq(artifacts.id, patchArtifact.id));
      await tx
        .update(runSteps)
        .set({
          completedAt: occurredAt,
          startedAt: step.startedAt ?? occurredAt,
          status: "succeeded",
          validationStatus: "green",
        })
        .where(eq(runSteps.id, step.id));
      await tx
        .update(loopRuns)
        .set({ currentStage: "validation", status: "running" })
        .where(eq(loopRuns.id, input.runId));

      input.logger?.info(
        {
          durationMs: Math.max(0, Date.now() - startedAt),
          outcome: "advanced",
          patchSha256: output.patch.sha256,
          runId: input.runId,
          stepId: step.id,
          testCount: output.greenEvidence.length,
        },
        "implementation_stage_advanced",
      );

      return {
        runId: input.runId,
        stage: "development",
        status: "advanced",
        stepId: step.id,
        ...((step.traceId ?? run.traceId)
          ? { traceId: step.traceId ?? run.traceId ?? undefined }
          : {}),
      };
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - startedAt),
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
