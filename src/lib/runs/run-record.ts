import { asc, eq, inArray } from "drizzle-orm";

import type { db } from "@/db/client";
import { approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { isProductionRuntime } from "@/lib/runtime";
import type {
  ArtifactKind,
  ArtifactRecord,
  RunApprovalRecord,
  RunRecord,
  RunStatus,
  RunStepStatus,
  TimelineEvent,
  TimelineKind,
  ValidationGateRecord,
  ValidationGateSummaryRecord,
} from "@/lib/types";
import { validationReportArtifactMetadataSchema } from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";

export type RunRecordDatabase = Pick<typeof db, "select">;
type ArtifactRow = typeof artifacts.$inferSelect;

export type RunRecordsResult =
  | {
      runs: RunRecord[];
      source: "db";
      usedFallback: false;
    }
  | {
      fallbackReason: string;
      runs: RunRecord[];
      source: "fixtures";
      usedFallback: true;
    }
  | {
      error: string;
      runs: [];
      source: "unavailable";
      usedFallback: false;
    };

function formatClock(value: Date | null | undefined): string {
  if (!value) {
    return "Pending";
  }

  return value.toISOString().slice(11, 16);
}

function formatAge(value: Date, now: Date): string {
  const diffMinutes = Math.max(1, Math.floor((now.getTime() - value.getTime()) / 60_000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function runPriority(status: RunStatus): number {
  const priorities = {
    waiting_for_approval: 0,
    blocked: 1,
    running: 2,
    queued: 3,
    failed: 4,
    succeeded: 5,
    canceled: 6,
  } satisfies Record<RunStatus, number>;

  return priorities[status];
}

function priorityLabel(status: RunStatus): string {
  const labels = {
    queued: "Queued",
    running: "Running",
    waiting_for_approval: "Waiting approval",
    blocked: "Blocked",
    failed: "Failed",
    succeeded: "Succeeded",
    canceled: "Canceled",
  } satisfies Record<RunStatus, string>;

  return labels[status];
}

function stageTitle(stage: string): string {
  const titles: Record<string, string> = {
    planning: "Planning",
    "test-writing": "Test writing",
    development: "Development",
    validation: "Validation",
    review: "Code review",
    "code-review": "Code review",
    commit: "Commit",
    pr: "PR",
    done: "Done",
  };

  return (
    titles[stage] ??
    stage
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function timelineKindForStage(stage: string): TimelineKind {
  const kinds: Record<string, TimelineKind> = {
    planning: "planning",
    "test-writing": "test",
    development: "development",
    validation: "validation",
    review: "review",
    "code-review": "review",
    commit: "commit",
    pr: "pull_request",
    done: "done",
  };

  return kinds[stage] ?? "state";
}

function artifactKind(type: string): ArtifactKind {
  if (type === "validation_report") {
    return "validation";
  }

  if (type === "deployment_summary") {
    return "preview";
  }

  if (type === "pr_intent" || type === "log_summary") {
    return "review";
  }

  return "log";
}

function artifactState(input: {
  stepStatus?: RunStepStatus;
  type: string;
}): ArtifactRecord["state"] {
  if (input.stepStatus === "failed") {
    return "failed";
  }

  if (input.stepStatus === "queued" || input.stepStatus === "running") {
    return "pending";
  }

  return "available";
}

function issueLabel(issueNumber: number | null): string | undefined {
  return issueNumber ? `#${issueNumber}` : undefined;
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataKind(metadata: Record<string, unknown> | null | undefined): string | undefined {
  return metadataString(metadata, "validationReportMetadataKind");
}

function emptyValidationSummary(
  detail = "No validation gates have completed for this run yet.",
): ValidationGateSummaryRecord {
  return {
    detail,
    gates: [],
    state: "empty",
  };
}

function errorValidationSummary(): ValidationGateSummaryRecord {
  return {
    detail: "Validation report metadata could not be parsed.",
    gates: [],
    state: "error",
  };
}

function formatValidationDuration(durationMs: number): string {
  const normalizedMs = Math.max(0, durationMs);
  if (normalizedMs === 0) {
    return "0s";
  }

  if (normalizedMs < 1000) {
    return `${normalizedMs}ms`;
  }

  const totalSeconds = Math.round(normalizedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  if (normalizedMs % 1000 === 0) {
    return `${totalSeconds}s`;
  }

  return `${(normalizedMs / 1000).toFixed(1)}s`;
}

function validationGateDetail(input: {
  exitCode: number | null;
  message?: string;
  outcome: ValidationGateRecord["outcome"];
  skipReason?: string;
}): string {
  if (input.message) {
    return input.message;
  }

  if (input.skipReason) {
    return input.skipReason;
  }

  if (input.outcome === "skipped") {
    return "Gate was skipped.";
  }

  if (input.exitCode !== null) {
    return `Gate exited with code ${input.exitCode}.`;
  }

  return "Gate completed.";
}

function validationSummaryForArtifacts(artifactRows: ArtifactRow[]): ValidationGateSummaryRecord {
  const latestValidationArtifact = [...artifactRows].reverse()[0];

  if (!latestValidationArtifact) {
    return emptyValidationSummary();
  }

  const kind = metadataKind(latestValidationArtifact.metadata);
  if (kind === "validation_report_contract" || !latestValidationArtifact.metadata) {
    return emptyValidationSummary();
  }

  if (kind !== "validation_report_result") {
    return errorValidationSummary();
  }

  const parsed = validationReportArtifactMetadataSchema.safeParse(
    latestValidationArtifact.metadata,
  );
  if (!parsed.success) {
    return errorValidationSummary();
  }

  const report = parsed.data.validationReport;
  if (report.results.length === 0) {
    return emptyValidationSummary(parsed.data.detail);
  }

  return {
    detail: parsed.data.detail,
    gates: report.results.map((result) => ({
      command: result.command,
      detail: validationGateDetail({
        exitCode: result.exitCode,
        message: result.message,
        outcome: result.outcome,
        skipReason: result.skipReason,
      }),
      duration: formatValidationDuration(result.durationMs),
      key: result.key,
      name: result.name,
      outcome: result.outcome,
      phase: result.phase,
      rawArtifactHref: result.output?.uri,
      required: result.required,
    })),
    generatedAt: report.generatedAt,
    state: "ready",
  };
}

function groupBy<T, K extends string>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  for (const item of items) {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return grouped;
}

export async function readRunRecords(input: {
  database: RunRecordDatabase;
  now?: Date;
}): Promise<RunRecordsResult> {
  const now = input.now ?? new Date();
  const runRows = await input.database
    .select({
      completedAt: loopRuns.completedAt,
      currentStage: loopRuns.currentStage,
      githubIssueNumber: loopRuns.githubIssueNumber,
      githubIssueUrl: loopRuns.githubIssueUrl,
      id: loopRuns.id,
      loopKey: loopRuns.loopKey,
      metadata: loopRuns.metadata,
      queuedAt: loopRuns.queuedAt,
      repositoryFullName: repositories.fullName,
      startedAt: loopRuns.startedAt,
      status: loopRuns.status,
    })
    .from(loopRuns)
    .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id));
  const runIds = runRows.map((run) => run.id);

  const [stepRows, artifactRows, approvalRows] =
    runIds.length > 0
      ? await Promise.all([
          input.database
            .select()
            .from(runSteps)
            .where(inArray(runSteps.runId, runIds))
            .orderBy(asc(runSteps.queuedAt)),
          input.database
            .select()
            .from(artifacts)
            .where(inArray(artifacts.runId, runIds))
            .orderBy(asc(artifacts.createdAt)),
          input.database
            .select()
            .from(approvals)
            .where(inArray(approvals.runId, runIds))
            .orderBy(asc(approvals.requestedAt)),
        ])
      : [[], [], []];

  const stepsByRun = groupBy(stepRows, (step) => step.runId);
  const artifactsByRun = groupBy(artifactRows, (artifact) => artifact.runId);
  const approvalsByRun = groupBy(
    approvalRows.filter((approval) => approval.runId),
    (approval) => approval.runId ?? "",
  );
  const stepStatusById = new Map(stepRows.map((step) => [step.id, step.status]));
  const artifactLabelByStepId = new Map(
    artifactRows
      .filter((artifact) => artifact.stepId)
      .map((artifact) => [artifact.stepId ?? "", artifact.title]),
  );

  const runs = runRows
    .map((run): RunRecord & { queuedAtTime: number } => {
      const runStepsForRun = stepsByRun.get(run.id) ?? [];
      const artifactRowsForRun = artifactsByRun.get(run.id) ?? [];
      const artifactsForRun = artifactRowsForRun.map((artifact) => ({
        detail: metadataString(artifact.metadata, "detail") ?? artifact.title,
        href: artifact.uri,
        kind: artifactKind(artifact.type),
        label: artifact.title,
        state: artifactState({
          stepStatus: artifact.stepId ? stepStatusById.get(artifact.stepId) : undefined,
          type: artifact.type,
        }),
      }));
      const approvalsForRun: RunApprovalRecord[] = (approvalsByRun.get(run.id) ?? []).map(
        (approval) => ({
          id: approval.id,
          ...(approval.note ? { note: approval.note } : {}),
          requestedAt: formatClock(approval.requestedAt),
          requestedBy: approval.requestedBy,
          ...(approval.resolvedAt ? { resolvedAt: formatClock(approval.resolvedAt) } : {}),
          ...(approval.resolvedBy ? { resolvedBy: approval.resolvedBy } : {}),
          scope: approval.scope,
          status: approval.status,
        }),
      );
      const steps: TimelineEvent[] = runStepsForRun.map((step) => ({
        actor: step.actorId,
        ...(artifactLabelByStepId.has(step.id)
          ? { artifact: artifactLabelByStepId.get(step.id) }
          : {}),
        at: formatClock(step.startedAt ?? step.queuedAt),
        detail: step.summary ?? `${stageTitle(step.stage)} stage is ${step.status}.`,
        id: step.id,
        kind: timelineKindForStage(step.stage),
        status: step.status,
        title: stageTitle(step.stage),
        ...(step.validationCommand ? { validationCommand: step.validationCommand } : {}),
        ...(step.validationStatus ? { validationStatus: step.validationStatus } : {}),
      }));

      return {
        age: formatAge(run.queuedAt, now),
        approvals: approvalsForRun,
        artifacts: artifactsForRun,
        ...(metadataString(run.metadata, "blockedReason")
          ? { blockedReason: metadataString(run.metadata, "blockedReason") }
          : {}),
        currentStage: run.currentStage,
        id: run.id,
        ...(issueLabel(run.githubIssueNumber) ? { issue: issueLabel(run.githubIssueNumber) } : {}),
        ...(run.githubIssueUrl ? { issueHref: run.githubIssueUrl } : {}),
        loopKey: run.loopKey,
        priorityLabel: priorityLabel(run.status),
        queuedAt: formatClock(run.queuedAt),
        queuedAtTime: run.queuedAt.getTime(),
        repositoryFullName: run.repositoryFullName,
        status: run.status,
        steps,
        validationSummary: validationSummaryForArtifacts(
          artifactRowsForRun.filter((artifact) => artifact.type === "validation_report"),
        ),
      };
    })
    .sort((left, right) => {
      const priorityDiff = runPriority(left.status) - runPriority(right.status);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      return left.queuedAtTime - right.queuedAtTime;
    })
    .map(({ queuedAtTime: _queuedAtTime, ...run }) => run);

  return {
    runs,
    source: "db",
    usedFallback: false,
  };
}

export function getRunRecordsForResult(
  result: RunRecordsResult,
  fixtureRuns: RunRecord[],
): RunRecord[] {
  if (result.source === "fixtures") {
    return fixtureRuns;
  }

  if (result.source === "unavailable") {
    return [];
  }

  return result.runs;
}

export function getRunSourceLabel(result: RunRecordsResult): string {
  if (result.source === "db") {
    return "Live runs";
  }

  if (result.source === "fixtures") {
    return "Fixture fallback";
  }

  return "Unavailable";
}

export async function getRunRecordsForPortal(input: {
  database: RunRecordDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
  fixtureRuns: RunRecord[];
  logger?: LoopworksLogger;
  now?: Date;
}): Promise<RunRecordsResult> {
  const env = input.env ?? process.env;
  if (!isProductionRuntime(env) && env.LOOPWORKS_PORTAL_DATA_MODE === "fixtures") {
    input.logger?.warn(
      { fallbackReason: "explicit_fixture_mode" },
      "run_records_fixture_mode_enabled",
    );

    return {
      fallbackReason: "explicit_fixture_mode",
      runs: input.fixtureRuns,
      source: "fixtures",
      usedFallback: true,
    };
  }

  try {
    return await readRunRecords({
      database: input.database,
      now: input.now,
    });
  } catch (error) {
    input.logger?.warn(
      {
        err: error,
      },
      "run_records_read_failed",
    );

    if (isProductionRuntime(env)) {
      return {
        error: "Run data store unavailable.",
        runs: [],
        source: "unavailable",
        usedFallback: false,
      };
    }

    return {
      fallbackReason: "database_unavailable",
      runs: input.fixtureRuns,
      source: "fixtures",
      usedFallback: true,
    };
  }
}
