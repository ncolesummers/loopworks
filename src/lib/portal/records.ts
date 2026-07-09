import { asc, desc } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  approvals,
  deployments as deploymentRows,
  loops,
  repositories,
  vercelProjects,
} from "@/db/schema";
import { createRepoRecordFromProjection } from "@/lib/catalog/repo-record";
import { portalFixture } from "@/lib/fixtures";
import type { ApprovalStatus } from "@/lib/approvals";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { readRunRecords, type RunRecordDatabase } from "@/lib/runs/run-record";
import { isProductionRuntime } from "@/lib/runtime";
import type {
  ApprovalGateRecord,
  ArtifactRecord,
  DeploymentEnvironment,
  DeploymentRecord,
  DeploymentState,
  GitHubSettingKey,
  GitHubSettingRecord,
  LoopRegistryItem,
  LoopState,
  RepoRecord,
  TimelineEvent,
  ValidationResultRecord,
  ValidationResultState,
} from "@/lib/types";

export type PortalRecordsDatabase = Pick<typeof db, "select">;

export type PortalRecords = {
  approval: ApprovalGateRecord | null;
  artifacts: ArtifactRecord[];
  deployments: DeploymentRecord[];
  githubSettings: GitHubSettingRecord[];
  loops: LoopRegistryItem[];
  repos: RepoRecord[];
  timeline: TimelineEvent[];
  validationResults: ValidationResultRecord[];
};

export type PortalRecordsResult =
  | {
      records: PortalRecords;
      source: "db";
      usedFallback: false;
    }
  | {
      fallbackReason: string;
      records: PortalRecords;
      source: "fixtures";
      usedFallback: true;
    }
  | {
      error: string;
      records: PortalRecords;
      source: "unavailable";
      usedFallback: false;
    };

type RepositoryRow = typeof repositories.$inferSelect;
type LoopRow = typeof loops.$inferSelect;
type DeploymentRow = typeof deploymentRows.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;

const emptyPortalRecords: PortalRecords = {
  approval: null,
  artifacts: [],
  deployments: [],
  githubSettings: [],
  loops: [],
  repos: [],
  timeline: [],
  validationResults: [],
};

function groupBy<T, K extends string>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const grouped = new Map<K, T[]>();

  for (const item of items) {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return grouped;
}

function firstBy<T, K extends string>(items: T[], getKey: (item: T) => K): Map<K, T | undefined> {
  const grouped = new Map<K, T | undefined>();

  for (const item of items) {
    const key = getKey(item);
    if (!grouped.has(key)) {
      grouped.set(key, item);
    }
  }

  return grouped;
}

function formatClock(value: Date): string {
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

function mapLoopState(state: LoopRow["state"]): LoopState {
  const states = {
    blocked: "Blocked",
    done: "Done",
    in_progress: "In Progress",
    intake: "Intake",
    planned: "Planned",
    triage: "Triage",
    validating: "Validating",
    waiting_on_review: "Waiting on Review",
  } satisfies Record<LoopRow["state"], LoopState>;

  return states[state];
}

function loopRisk(state: LoopRow["state"]): LoopRegistryItem["risk"] {
  if (state === "blocked" || state === "waiting_on_review") {
    return "high";
  }

  if (state === "in_progress" || state === "validating") {
    return "medium";
  }

  return "low";
}

function loopEnabled(state: LoopRow["state"]): boolean {
  return state !== "blocked" && state !== "done";
}

function mapLoops(loopRows: LoopRow[], runIssueCounts: Map<number, number>): LoopRegistryItem[] {
  return loopRows.map((loop) => {
    const enabled = loopEnabled(loop.state);

    return {
      enabled,
      name: loop.title,
      owner: loop.ownerGithubLogin ?? "Unassigned",
      queueDepth: runIssueCounts.get(loop.githubIssueNumber) ?? 0,
      risk: loopRisk(loop.state),
      ...(enabled ? {} : { skippedReason: loop.state === "done" ? "loop_done" : "loop_blocked" }),
      state: mapLoopState(loop.state),
    };
  });
}

function normalizeDeploymentEnvironment(value: string): DeploymentEnvironment {
  if (value === "production" || value === "preview" || value === "development") {
    return value;
  }

  return "development";
}

function mapDeploymentRow(row: DeploymentRow, now: Date): DeploymentRecord {
  const state = row.status satisfies DeploymentState;
  const environment = normalizeDeploymentEnvironment(row.environment);
  const isReady = row.status === "ready";

  return {
    age: formatAge(row.createdAt, now),
    ...(row.branch ? { branch: row.branch } : {}),
    checks: isReady
      ? [environment === "production" ? "Build ready" : "Preview ready"]
      : row.status === "building"
        ? ["Build started"]
        : row.status === "error"
          ? ["Build failed"]
          : row.status === "queued"
            ? ["Waiting for upload"]
            : ["Deployment canceled"],
    environment,
    ...(row.inspectorUrl ? { inspectorUrl: row.inspectorUrl } : {}),
    name: `${environment}/${row.branch ?? row.projectName}`,
    ...(row.commitSha
      ? { sha: row.commitSha === "pending" ? "pending" : row.commitSha.slice(0, 7) }
      : {}),
    state,
    url: row.url,
  };
}

function preferredRun(runs: Awaited<ReturnType<typeof readRunRecords>>["runs"]) {
  return runs.find((run) => run.status === "succeeded") ?? runs[0];
}

function validationResultStatus(outcome: "fail" | "pass" | "skipped"): ValidationResultState {
  if (outcome === "pass") {
    return "passed";
  }

  if (outcome === "fail") {
    return "failed";
  }

  return "skipped";
}

function validationResultsForRun(run: ReturnType<typeof preferredRun>): ValidationResultRecord[] {
  if (run?.validationSummary.state !== "ready") {
    return [];
  }

  return run.validationSummary.gates.map((gate) => ({
    ...(gate.rawArtifactHref ? { artifactHref: gate.rawArtifactHref } : {}),
    command: gate.command,
    detail: gate.detail,
    duration: gate.duration,
    name: gate.name,
    status: validationResultStatus(gate.outcome),
  }));
}

function approvalPriority(status: ApprovalStatus): number {
  const priorities = {
    requested: 0,
    rejected: 1,
    bypassed: 2,
    expired: 3,
    approved: 4,
    applied: 5,
    cancelled: 6,
  } satisfies Record<ApprovalStatus, number>;

  return priorities[status];
}

function mapApproval(approvalRows: ApprovalRow[]): ApprovalGateRecord | null {
  const approval = [...approvalRows].sort((left, right) => {
    const priorityDiff = approvalPriority(left.status) - approvalPriority(right.status);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return right.requestedAt.getTime() - left.requestedAt.getTime();
  })[0];

  if (!approval) {
    return null;
  }

  return {
    checklist: [
      { done: true, label: `Scope ${approval.scope}` },
      { done: true, label: `Requested by ${approval.requestedBy}` },
      {
        done: Boolean(approval.loopId),
        label: approval.loopId ? "Loop context attached" : "No loop context attached",
      },
      {
        done: Boolean(approval.resolvedAt),
        label: approval.resolvedAt ? "Resolution recorded" : "Awaiting resolution",
      },
    ],
    due: approval.resolvedAt
      ? `Resolved ${formatClock(approval.resolvedAt)}`
      : `Requested ${formatClock(approval.requestedAt)}`,
    owner: approval.requestedBy,
    risk: approval.note ?? `Approval scope ${approval.scope}.`,
    state: approval.status,
  };
}

function setting(
  key: GitHubSettingKey,
  title: string,
  detail: string,
  enabled: boolean,
): GitHubSettingRecord {
  return { detail, enabled, key, title };
}

function mapSettings(input: {
  approvals: ApprovalRow[];
  loops: LoopRow[];
  repositories: RepositoryRow[];
  runArtifacts: ArtifactRecord[];
}): GitHubSettingRecord[] {
  const installedRepos = input.repositories.filter((repo) => repo.installationId !== null);
  const hasLabels = input.loops.some(
    (loop) => loop.areaLabel || loop.milestone || loop.priorityLabel,
  );
  const hasPrArtifacts = input.runArtifacts.some((artifact) => artifact.label.includes("PR"));

  return [
    setting(
      "sso",
      "GitHub SSO",
      installedRepos.length > 0
        ? `${installedRepos.length} repositories have GitHub installation metadata.`
        : "No repositories have GitHub installation metadata yet.",
      installedRepos.length > 0,
    ),
    setting(
      "webhooks",
      "Webhooks",
      input.loops.length > 0
        ? "Loop rows are available from issue synchronization."
        : "Webhook issue synchronization has not populated loops yet.",
      input.loops.length > 0,
    ),
    setting(
      "issue-sync",
      "Issue sync",
      input.loops.length > 0
        ? `${input.loops.length} synced issue loops are visible.`
        : "No issue loops are synced yet.",
      input.loops.length > 0,
    ),
    setting(
      "pr-sync",
      "PR sync",
      hasPrArtifacts
        ? "PR intent artifacts are available from completed runs."
        : "No PR intent artifacts are available yet.",
      hasPrArtifacts,
    ),
    setting(
      "label-mapping",
      "Label mapping",
      hasLabels
        ? "Milestone, area, and priority labels are mapped into loop state."
        : "No milestone, area, or priority labels are mapped yet.",
      hasLabels,
    ),
    setting(
      "secret-redaction",
      "Secret redaction",
      input.approvals.length > 0
        ? "Approval summaries avoid token and credential material."
        : "No approval summaries are available to project redaction state yet.",
      input.approvals.length > 0,
    ),
  ];
}

function fixturePortalRecords(): PortalRecords {
  return {
    approval: portalFixture.approval,
    artifacts: portalFixture.artifacts,
    deployments: portalFixture.deployments,
    githubSettings: portalFixture.githubSettings,
    loops: portalFixture.loops,
    repos: portalFixture.repos,
    timeline: portalFixture.timeline,
    validationResults: portalFixture.validationResults,
  };
}

function unavailablePortalRecords(): PortalRecords {
  return emptyPortalRecords;
}

function hasRequiredPortalData(records: PortalRecords): boolean {
  return (
    records.repos.length > 0 &&
    records.loops.length > 0 &&
    records.deployments.length > 0 &&
    records.approval !== null &&
    records.githubSettings.length > 0
  );
}

function unavailableResult(): PortalRecordsResult {
  return {
    error: "Portal data store unavailable.",
    records: unavailablePortalRecords(),
    source: "unavailable",
    usedFallback: false,
  };
}

export async function readPortalRecords(input: {
  database: PortalRecordsDatabase;
  now?: Date;
}): Promise<PortalRecordsResult> {
  const now = input.now ?? new Date();
  const [
    repositoryRows,
    loopRows,
    vercelProjectRows,
    deploymentRowsResult,
    approvalRows,
    runResult,
  ] = await Promise.all([
    input.database.select().from(repositories).orderBy(asc(repositories.name)),
    input.database.select().from(loops).orderBy(asc(loops.githubIssueNumber)),
    input.database.select().from(vercelProjects).orderBy(asc(vercelProjects.projectName)),
    input.database.select().from(deploymentRows).orderBy(desc(deploymentRows.createdAt)),
    input.database.select().from(approvals).orderBy(asc(approvals.requestedAt)),
    readRunRecords({
      database: input.database as RunRecordDatabase,
      now,
    }),
  ]);
  const loopsByRepository = groupBy(loopRows, (loop) => loop.repositoryId);
  const vercelProjectByRepository = firstBy(vercelProjectRows, (project) => project.repositoryId);
  const runIssueCounts = new Map<number, number>();
  for (const run of runResult.runs) {
    const issueNumber = run.issue?.startsWith("#")
      ? Number.parseInt(run.issue.slice(1), 10)
      : Number.NaN;
    if (Number.isInteger(issueNumber)) {
      runIssueCounts.set(issueNumber, (runIssueCounts.get(issueNumber) ?? 0) + 1);
    }
  }
  const selectedRun = preferredRun(runResult.runs);

  const artifacts = selectedRun?.artifacts ?? [];

  return {
    records: {
      approval: mapApproval(approvalRows),
      artifacts,
      deployments: deploymentRowsResult.map((deployment) => mapDeploymentRow(deployment, now)),
      githubSettings: mapSettings({
        approvals: approvalRows,
        loops: loopRows,
        repositories: repositoryRows,
        runArtifacts: artifacts,
      }),
      loops: mapLoops(loopRows, runIssueCounts),
      repos: repositoryRows.map((repository) =>
        createRepoRecordFromProjection({
          loops: loopsByRepository.get(repository.id) ?? [],
          now,
          repository,
          vercelProject: vercelProjectByRepository.get(repository.id) ?? null,
        }),
      ),
      timeline: selectedRun?.steps ?? [],
      validationResults: validationResultsForRun(selectedRun),
    },
    source: "db",
    usedFallback: false,
  };
}

export async function getPortalRecordsForPortal(input: {
  database: PortalRecordsDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
  logger?: LoopworksLogger;
  now?: Date;
}): Promise<PortalRecordsResult> {
  try {
    const result = await readPortalRecords({
      database: input.database,
      now: input.now,
    });

    if (isProductionRuntime(input.env) && !hasRequiredPortalData(result.records)) {
      input.logger?.warn(
        {
          approvalCount: result.records.approval ? 1 : 0,
          deploymentCount: result.records.deployments.length,
          loopCount: result.records.loops.length,
          repositoryCount: result.records.repos.length,
          settingsCount: result.records.githubSettings.length,
        },
        "portal_records_required_data_missing",
      );

      return unavailableResult();
    }

    return result;
  } catch (error) {
    input.logger?.warn(
      {
        err: error,
      },
      "portal_records_read_failed",
    );

    if (isProductionRuntime(input.env)) {
      return unavailableResult();
    }

    return {
      fallbackReason: "database_unavailable",
      records: fixturePortalRecords(),
      source: "fixtures",
      usedFallback: true,
    };
  }
}

export function getPortalSourceLabel(result: PortalRecordsResult): string {
  if (result.source === "db") {
    return "Live database";
  }

  if (result.source === "fixtures") {
    return "Fixture fallback";
  }

  return "Unavailable";
}
