import {
  computePrPreparationDigest,
  type PrPreparationResult,
  prPreparationResultSchema,
} from "@agent/pr-preparation-agent";
import {
  createPrPreparationResultFromContext,
  loadPrPreparationContextWithDatabase,
  type PrPreparationReadDatabase,
} from "@agent/subagents/pr-preparer/lib/context";
import { and, eq, isNull, sql } from "drizzle-orm";
import { approvals, artifacts, runSteps } from "@/db/schema";
import { createPrIntentArtifactMetadata } from "@/lib/loops/pr-intent";
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
  prApprovalScope,
} from "./shared";

export type PrPreparationTransitionResult = {
  idempotent?: boolean;
  intentSha256: string;
  runId: string;
  stage: "pr";
  status: "prepared";
  stepId: string;
  traceId?: string;
};

export async function applyDevelopmentLoopPrPreparationResult(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  output: PrPreparationResult;
  runId: string;
  runUrl: string;
}): Promise<PrPreparationTransitionResult> {
  const output = prPreparationResultSchema.parse(input.output);
  const digest = computePrPreparationDigest(output);
  const transitionStartedAt = Date.now();
  const span = startLoopworksSpan("loopworks.pr_preparation.transition", {
    attributes: {
      "loopworks.agent": "pr-preparer",
      "loopworks.artifact_count": output.intent.artifacts.length,
      "loopworks.deployment_present": Boolean(output.intent.deployment),
      "loopworks.run_id": input.runId,
      "loopworks.screenshot_count": output.screenshots.length,
      "loopworks.stage": "pr",
    },
  });
  try {
    const result = await input.database.transaction<PrPreparationTransitionResult>(async (tx) => {
      await assertDevelopmentLoopExecutionLease(tx, input.runId, "pr");
      const context = await loadPrPreparationContextWithDatabase(
        tx as unknown as PrPreparationReadDatabase,
        input.runId,
        input.runUrl,
      );
      const [prArtifact] = await tx
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.runId, input.runId),
            eq(artifacts.stepId, context.prStep.id),
            eq(artifacts.type, "pr_intent"),
          ),
        );
      if (!prArtifact) {
        throw new DevelopmentLoopTransitionError("PR preparation artifact is missing.");
      }
      const existingDigest = (prArtifact.metadata as { prPreparationResultSha256?: unknown } | null)
        ?.prPreparationResultSha256;
      if (typeof existingDigest === "string") {
        if (existingDigest !== digest) {
          throw new DevelopmentLoopTransitionError(
            "PR preparation replay has conflicting persisted intent.",
          );
        }
        return {
          idempotent: true,
          intentSha256: digest,
          runId: input.runId,
          stage: "pr",
          status: "prepared",
          stepId: context.prStep.id,
        };
      }
      const expected = createPrPreparationResultFromContext(context, output.narrative);
      if (computePrPreparationDigest(expected) !== digest) {
        throw new DevelopmentLoopTransitionError(
          "PR preparation result does not match the exact persisted handoff.",
        );
      }
      const matchingApprovals = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, prApprovalScope)));
      const approval = matchingApprovals.length === 1 ? matchingApprovals[0] : undefined;
      if (approval?.status !== "requested") {
        throw new DevelopmentLoopTransitionError(
          "PR preparation requires one requested external-write approval.",
        );
      }
      const [claimedArtifact] = await tx
        .update(artifacts)
        .set({
          metadata: {
            ...createPrIntentArtifactMetadata(output.intent),
            prPreparationResult: output,
            prPreparationResultSchemaId: output.schemaId,
            prPreparationResultSha256: digest,
          },
          sha256: digest,
        })
        .where(
          and(
            eq(artifacts.id, prArtifact.id),
            isNull(artifacts.sha256),
            sql`not coalesce(${artifacts.metadata} ? 'prPreparationResultSha256', false)`,
          ),
        )
        .returning({ id: artifacts.id });
      if (!claimedArtifact) {
        const [persistedArtifact] = await tx
          .select({ metadata: artifacts.metadata })
          .from(artifacts)
          .where(eq(artifacts.id, prArtifact.id))
          .limit(1);
        const persistedDigest = (
          persistedArtifact?.metadata as { prPreparationResultSha256?: unknown } | null
        )?.prPreparationResultSha256;
        if (persistedDigest === digest) {
          return {
            idempotent: true,
            intentSha256: digest,
            runId: input.runId,
            stage: "pr",
            status: "prepared",
            stepId: context.prStep.id,
          };
        }
        throw new DevelopmentLoopTransitionError(
          "PR preparation replay has conflicting persisted intent.",
        );
      }
      const [boundApproval] = await tx
        .update(approvals)
        .set({
          metadata: {
            ...(approval.metadata ?? {}),
            prIntentDigest: digest,
          },
        })
        .where(and(eq(approvals.id, approval.id), eq(approvals.status, "requested")))
        .returning({ id: approvals.id });
      if (!boundApproval) {
        throw new DevelopmentLoopTransitionError(
          "External-write approval changed before PR intent binding completed.",
        );
      }
      const [currentPrStep] = await tx
        .select({ metadata: runSteps.metadata })
        .from(runSteps)
        .where(eq(runSteps.id, context.prStep.id));
      await tx
        .update(runSteps)
        .set({
          metadata: {
            ...(currentPrStep?.metadata ?? {}),
            ...(context.prStep.status === "running" ? { preparationStarted: true } : {}),
            prPreparationResultSchemaId: output.schemaId,
            prPreparationResultSha256: digest,
          },
        })
        .where(eq(runSteps.id, context.prStep.id));
      return {
        intentSha256: digest,
        runId: input.runId,
        stage: "pr",
        status: "prepared",
        stepId: context.prStep.id,
      };
    });
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.idempotent": result.idempotent ?? false,
      "loopworks.intent_sha256": digest,
      "loopworks.outcome": result.status,
    });
    markLoopworksSpanOk(span);
    input.logger?.info(
      {
        artifactCount: output.intent.artifacts.length,
        deploymentPresent: Boolean(output.intent.deployment),
        idempotent: result.idempotent ?? false,
        intentSha256: digest,
        model: output.model,
        runId: input.runId,
        screenshotCount: output.screenshots.length,
        stage: "pr",
        status: result.status,
        stepId: result.stepId,
      },
      "development_loop_pr_preparation_persisted",
    );
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}
