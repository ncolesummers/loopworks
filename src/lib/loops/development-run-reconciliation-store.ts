import { and, eq, or } from "drizzle-orm";

import type { db } from "@/db/client";
import { idempotencyLocks, loopRuns, repositories, runSteps } from "@/db/schema";
import type {
  DevelopmentLoopActiveRun,
  DevelopmentLoopExecutionLiveness,
  DevelopmentLoopFinalizationSkipped,
  DevelopmentLoopRunStore,
} from "@/lib/loops/development-run-reconciliation";
import {
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  finalizeDevelopmentLoopRun,
} from "@/lib/loops/transitions";
import type { LoopworksLogger } from "@/lib/observability/logger";
import type { LoopManifest } from "../../../schemas/loop-manifest";

export type DevelopmentLoopReconciliationDatabase = Pick<typeof db, "select" | "transaction">;

function latestActivity(
  steps: Array<typeof runSteps.$inferSelect>,
  currentStage: string,
): Date | null {
  const timestamps = steps
    .filter((step) => step.stage === currentStage || step.status !== "queued")
    .flatMap((step) =>
      [step.queuedAt, step.startedAt, step.completedAt].filter((value): value is Date =>
        Boolean(value),
      ),
    );
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps.map((value) => value.getTime())));
}

export function createDevelopmentLoopRunStore(input: {
  clock?: () => Date;
  database: DevelopmentLoopReconciliationDatabase;
  executionLiveness?: (run: DevelopmentLoopActiveRun) => Promise<DevelopmentLoopExecutionLiveness>;
  logger?: LoopworksLogger;
  manifest?: LoopManifest;
  metrics?: DevelopmentLoopTransitionMetrics;
}): DevelopmentLoopRunStore {
  return {
    async listActiveRuns() {
      const rows = await input.database
        .select({
          currentStage: loopRuns.currentStage,
          githubIssueNumber: loopRuns.githubIssueNumber,
          installationId: repositories.installationId,
          loopKey: loopRuns.loopKey,
          repositoryFullName: repositories.fullName,
          repositoryName: repositories.name,
          repositoryOwner: repositories.owner,
          runId: loopRuns.id,
          status: loopRuns.status,
          traceId: loopRuns.traceId,
        })
        .from(loopRuns)
        .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
        .where(
          and(
            or(eq(loopRuns.status, "running"), eq(loopRuns.status, "queued")),
            eq(loopRuns.loopKey, "development-loop"),
          ),
        );

      const activeRuns = await Promise.all(
        rows.map(async (row) => {
          if (row.status === "queued") {
            const [lease] = await input.database
              .select({ id: idempotencyLocks.id })
              .from(idempotencyLocks)
              .where(
                and(
                  eq(idempotencyLocks.runId, row.runId),
                  eq(idempotencyLocks.owner, row.runId),
                  eq(idempotencyLocks.status, "acquired"),
                ),
              )
              .limit(1);
            if (!lease) return null;
          }
          const steps = await input.database
            .select()
            .from(runSteps)
            .where(eq(runSteps.runId, row.runId));
          const currentStep = steps.find((step) => step.stage === row.currentStage);
          return {
            currentStage: row.currentStage,
            ...(currentStep ? { currentStepId: currentStep.id } : {}),
            ...(currentStep?.traceId ? { currentStepTraceId: currentStep.traceId } : {}),
            githubIssueNumber: row.githubIssueNumber,
            installationId: row.installationId,
            latestStepActivityAt: latestActivity(steps, row.currentStage),
            loopKey: row.loopKey,
            repositoryFullName: row.repositoryFullName,
            repositoryName: row.repositoryName,
            repositoryOwner: row.repositoryOwner,
            runId: row.runId,
            ...(row.traceId ? { traceId: row.traceId } : {}),
          } satisfies DevelopmentLoopActiveRun;
        }),
      );
      return activeRuns.filter((run): run is DevelopmentLoopActiveRun => run !== null);
    },
    async getExecutionLiveness(run) {
      if (input.executionLiveness) return input.executionLiveness(run);
      try {
        const [lease] = await input.database
          .select({
            expiresAt: idempotencyLocks.expiresAt,
            owner: idempotencyLocks.owner,
            status: idempotencyLocks.status,
          })
          .from(idempotencyLocks)
          .where(and(eq(idempotencyLocks.runId, run.runId), eq(idempotencyLocks.owner, run.runId)))
          .limit(1);
        if (!lease) return "unknown";
        if (lease.status !== "acquired" || lease.owner !== run.runId) return "inactive";
        return lease.expiresAt.getTime() > (input.clock?.() ?? new Date()).getTime()
          ? "active"
          : "inactive";
      } catch {
        return "unknown";
      }
    },
    async finalizeRun(finalizeInput) {
      if (finalizeInput.expected) {
        const [freshRun] = await input.database
          .select({ currentStage: loopRuns.currentStage, status: loopRuns.status })
          .from(loopRuns)
          .where(eq(loopRuns.id, finalizeInput.runId))
          .limit(1);
        const freshSteps = await input.database
          .select()
          .from(runSteps)
          .where(eq(runSteps.runId, finalizeInput.runId));
        const freshCurrentStep = freshSteps.find((step) => step.stage === freshRun?.currentStage);
        const freshActivity = freshRun ? latestActivity(freshSteps, freshRun.currentStage) : null;
        const expectedActivityMs = finalizeInput.expected.latestStepActivityAt?.getTime() ?? null;
        const freshActivityMs = freshActivity?.getTime() ?? null;
        if (
          freshRun?.status !== "running" ||
          freshRun.currentStage !== finalizeInput.expected.currentStage ||
          freshCurrentStep?.id !== finalizeInput.expected.currentStepId ||
          freshActivityMs !== expectedActivityMs
        ) {
          return {
            finalized: false,
            reason: "state_changed",
            runId: finalizeInput.runId,
          } satisfies DevelopmentLoopFinalizationSkipped;
        }
      }

      try {
        return await finalizeDevelopmentLoopRun({
          database: input.database as DevelopmentLoopTransitionDatabase,
          ...(finalizeInput.expected
            ? { expectedCurrentStage: finalizeInput.expected.currentStage }
            : {}),
          logger: input.logger,
          manifest: input.manifest,
          metrics: input.metrics,
          occurredAt: finalizeInput.occurredAt,
          reason: finalizeInput.reason,
          runId: finalizeInput.runId,
        });
      } catch (error) {
        if (finalizeInput.expected && error instanceof DevelopmentLoopTransitionError) {
          return {
            finalized: false,
            reason: "state_changed",
            runId: finalizeInput.runId,
          } satisfies DevelopmentLoopFinalizationSkipped;
        }
        throw error;
      }
    },
  };
}
