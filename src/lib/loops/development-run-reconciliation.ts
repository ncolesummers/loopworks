import type { GitHubIssueReader, GitHubIssueSnapshot } from "@/lib/github/issue-reader";
import type { LoopManifest } from "../../../schemas/loop-manifest";
import type {
  DevelopmentLoopTerminalReason,
  DevelopmentLoopTerminalStatus,
} from "@/lib/loops/development-run-transitions";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startDevelopmentLoopReconciliationSpan,
} from "@/lib/observability/trace-context";

export type DevelopmentLoopExecutionLiveness = "active" | "inactive" | "unknown";

export type DevelopmentLoopActiveRun = {
  currentStage: string;
  currentStepId?: string;
  currentStepTraceId?: string;
  githubIssueNumber: number | null;
  installationId: number | null;
  latestStepActivityAt: Date | null;
  loopKey: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  runId: string;
  traceId?: string;
};

export type DevelopmentLoopFinalizationResult = {
  durationSeconds: number;
  idempotent?: boolean;
  reason: DevelopmentLoopTerminalReason;
  runId: string;
  status: DevelopmentLoopTerminalStatus;
  traceId?: string;
};

export type DevelopmentLoopFinalizationSkipped = {
  finalized: false;
  reason: "state_changed";
  runId: string;
};

export type DevelopmentLoopRunStore = {
  finalizeRun(input: {
    expected?: {
      currentStage: string;
      currentStepId?: string;
      latestStepActivityAt: Date | null;
    };
    occurredAt: Date;
    reason: DevelopmentLoopTerminalReason;
    runId: string;
  }): Promise<DevelopmentLoopFinalizationResult | DevelopmentLoopFinalizationSkipped>;
  getExecutionLiveness(run: DevelopmentLoopActiveRun): Promise<DevelopmentLoopExecutionLiveness>;
  listActiveRuns(): Promise<DevelopmentLoopActiveRun[]>;
};

function isSkippedFinalization(
  result: DevelopmentLoopFinalizationResult | DevelopmentLoopFinalizationSkipped,
): result is DevelopmentLoopFinalizationSkipped {
  return "finalized" in result && result.finalized === false;
}

export type DevelopmentLoopResolvedCancellationPolicy = {
  cause: "loop_disabled" | "issue_closed" | "trigger_removed";
  configuredValue: "skip_new_runs" | "cancel_running" | "mark_canceled" | "continue_existing";
  decision: "cancel" | "continue";
  source: "onDisabled" | "onSuperseded";
};

export type DevelopmentLoopReconciliationOutcome = {
  action:
    | "finalized"
    | "healthy"
    | "policy_continued"
    | "liveness_unknown"
    | "issue_refresh_failed";
  policy?: DevelopmentLoopResolvedCancellationPolicy;
  runId: string;
  status?: DevelopmentLoopTerminalStatus;
  terminalReason?: DevelopmentLoopTerminalReason;
  traceId?: string;
};

function disabledPolicy(
  loop: LoopManifest["loops"][number],
): DevelopmentLoopResolvedCancellationPolicy | undefined {
  if (loop.enabled) return undefined;
  return {
    cause: "loop_disabled",
    configuredValue: loop.cancellation.onDisabled,
    decision: loop.cancellation.onDisabled === "cancel_running" ? "cancel" : "continue",
    source: "onDisabled",
  };
}

function supersededPolicy(
  loop: LoopManifest["loops"][number],
  issue: GitHubIssueSnapshot,
): DevelopmentLoopResolvedCancellationPolicy | undefined {
  const triggerLabels = loop.triggers.issueLabels.map((label) => label.trim().toLowerCase());
  const issueLabels = new Set(issue.labels.map((label) => label.trim().toLowerCase()));
  const cause =
    issue.state === "closed"
      ? "issue_closed"
      : triggerLabels.every((label) => issueLabels.has(label))
        ? undefined
        : "trigger_removed";
  if (!cause) return undefined;
  return {
    cause,
    configuredValue: loop.cancellation.onSuperseded,
    decision: loop.cancellation.onSuperseded === "mark_canceled" ? "cancel" : "continue",
    source: "onSuperseded",
  };
}

async function finalize(input: {
  occurredAt: Date;
  policy?: DevelopmentLoopResolvedCancellationPolicy;
  reason: DevelopmentLoopTerminalReason;
  run: DevelopmentLoopActiveRun;
  runStore: DevelopmentLoopRunStore;
}): Promise<DevelopmentLoopReconciliationOutcome> {
  const result = await input.runStore.finalizeRun({
    ...(input.reason === "stalled" || input.reason === "timed_out"
      ? {
          expected: {
            currentStage: input.run.currentStage,
            ...(input.run.currentStepId ? { currentStepId: input.run.currentStepId } : {}),
            latestStepActivityAt: input.run.latestStepActivityAt,
          },
        }
      : {}),
    occurredAt: input.occurredAt,
    reason: input.reason,
    runId: input.run.runId,
  });
  if (isSkippedFinalization(result)) {
    return {
      action: "healthy",
      ...(input.policy ? { policy: input.policy } : {}),
      runId: input.run.runId,
      ...(input.run.traceId ? { traceId: input.run.traceId } : {}),
    };
  }
  return {
    action: "finalized",
    ...(input.policy ? { policy: input.policy } : {}),
    runId: input.run.runId,
    status: result.status,
    terminalReason: result.reason,
    ...((result.traceId ?? input.run.traceId)
      ? { traceId: result.traceId ?? input.run.traceId }
      : {}),
  };
}

export async function reconcileDevelopmentLoopRuns(input: {
  clock: () => Date;
  issueReader: GitHubIssueReader;
  logger?: LoopworksLogger;
  manifest: LoopManifest;
  runStore: DevelopmentLoopRunStore;
}): Promise<{ outcomes: DevelopmentLoopReconciliationOutcome[]; reconciledAt: Date }> {
  const reconciliationSpan = startDevelopmentLoopReconciliationSpan();
  const { span } = reconciliationSpan;
  const reconciledAt = input.clock();

  try {
    const runs = await input.runStore.listActiveRuns();
    reconciliationSpan.setRunCount(runs.length);
    const outcomes: DevelopmentLoopReconciliationOutcome[] = [];

    for (const run of runs) {
      const loop = input.manifest.loops.find((candidate) => candidate.key === run.loopKey);
      if (!loop) {
        outcomes.push({ action: "issue_refresh_failed", runId: run.runId });
        continue;
      }

      let policy = disabledPolicy(loop);
      if (policy?.decision === "cancel") {
        outcomes.push(
          await finalize({
            occurredAt: reconciledAt,
            policy,
            reason: "canceled_by_reconciliation",
            run,
            runStore: input.runStore,
          }),
        );
        continue;
      }

      let issueRefreshFailed = false;
      if (run.installationId === null || run.githubIssueNumber === null) {
        issueRefreshFailed = true;
      } else {
        try {
          const issue = await input.issueReader.getIssue({
            installationId: run.installationId,
            issueNumber: run.githubIssueNumber,
            owner: run.repositoryOwner,
            repo: run.repositoryName,
          });
          const trackerPolicy = supersededPolicy(loop, issue);
          if (trackerPolicy) policy = trackerPolicy;
        } catch (error) {
          issueRefreshFailed = true;
          input.logger?.warn(
            {
              errorType: error instanceof Error ? error.name : "unknown",
              runId: run.runId,
              traceId: run.traceId,
            },
            "development_loop_reconciliation_issue_refresh_failed",
          );
        }
      }

      if (policy?.decision === "cancel") {
        outcomes.push(
          await finalize({
            occurredAt: reconciledAt,
            policy,
            reason: "canceled_by_reconciliation",
            run,
            runStore: input.runStore,
          }),
        );
        continue;
      }

      let liveness: DevelopmentLoopExecutionLiveness;
      try {
        liveness = await input.runStore.getExecutionLiveness(run);
      } catch {
        liveness = "unknown";
        input.logger?.warn(
          { runId: run.runId, traceId: run.traceId },
          "development_loop_reconciliation_liveness_unavailable",
        );
      }
      if (liveness === "inactive") {
        outcomes.push(
          await finalize({
            occurredAt: reconciledAt,
            ...(policy ? { policy } : {}),
            reason: "timed_out",
            run,
            runStore: input.runStore,
          }),
        );
        continue;
      }
      if (liveness === "active" && run.latestStepActivityAt) {
        const cutoff = reconciledAt.getTime() - loop.reconciliation.silenceThresholdSeconds * 1000;
        if (run.latestStepActivityAt.getTime() < cutoff) {
          outcomes.push(
            await finalize({
              occurredAt: reconciledAt,
              ...(policy ? { policy } : {}),
              reason: "stalled",
              run,
              runStore: input.runStore,
            }),
          );
          continue;
        }
      }

      const action =
        liveness === "unknown"
          ? "liveness_unknown"
          : policy?.decision === "continue"
            ? "policy_continued"
            : issueRefreshFailed
              ? "issue_refresh_failed"
              : "healthy";
      outcomes.push({
        action,
        ...(policy ? { policy } : {}),
        runId: run.runId,
        ...(run.traceId ? { traceId: run.traceId } : {}),
      });
    }

    input.logger?.info(
      { outcomeCount: outcomes.length, reconciledAt: reconciledAt.toISOString() },
      "development_loop_runs_reconciled",
    );
    markLoopworksSpanOk(span);
    return { outcomes, reconciledAt };
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}
