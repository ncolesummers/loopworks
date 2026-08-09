import { asc, desc, eq } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  approvals,
  deployments as deploymentRows,
  githubInstallations,
  loopDefinitions,
  loops,
  repositories,
  vercelProjects,
} from "@/db/schema";
import type { ApprovalStatus } from "@/lib/approvals";
import { createRepoRecordFromProjection } from "@/lib/catalog/repo-record";
import { readSuppliedRawConfig } from "@/lib/config/registry";
import { portalFixture } from "@/lib/fixtures";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { type RunRecordDatabase, readRunRecords } from "@/lib/runs/run-record";
import { isProductionRuntime } from "@/lib/runtime";
import type {
  ApprovalGateRecord,
  ArtifactRecord,
  DeploymentEnvironment,
  DeploymentRecord,
  DeploymentState,
  GitHubInstallationRecord,
  GitHubSettingKey,
  GitHubSettingRecord,
  LoopRegistryItem,
  LoopState,
  RegisteredLoopItem,
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
  githubInstallations: GitHubInstallationRecord[];
  githubSettings: GitHubSettingRecord[];
  loops: LoopRegistryItem[];
  registeredLoops: RegisteredLoopItem[];
  repos: RepoRecord[];
  timeline: TimelineEvent[];
  validationResults: ValidationResultRecord[];
};

/**
 * A collection a portal surface can declare it cannot render without. Surfaces
 * that have a real empty state declare `[]` and render that state instead.
 *
 * `githubSettings` is deliberately absent: `mapSettings` always projects the
 * full key set, so declaring it could never fail.
 */
export type PortalDataRequirement =
  | "approval"
  | "deployments"
  | "githubInstallations"
  | "loops"
  | "repos";

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

type LoopRow = typeof loops.$inferSelect;
type LoopDefinitionRow = {
  definition: typeof loopDefinitions.$inferSelect.definition;
  enabled: boolean;
  loopKey: string;
  repositoryFullName: string;
};
type DeploymentRow = typeof deploymentRows.$inferSelect;
type ApprovalRow = typeof approvals.$inferSelect;
type GithubInstallationRow = typeof githubInstallations.$inferSelect;

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

/**
 * Reduces the stored contract to the fields the registry renders (PRD UX requirement 4). The whole
 * definition stays in the database; the portal projection deliberately carries no budgets, model
 * policy, or tool policy.
 */
function mapRegisteredLoops(rows: LoopDefinitionRow[]): RegisteredLoopItem[] {
  return rows.map((row) => ({
    approvalRequirements: [...row.definition.approvals.requiredFor],
    // The column is the queryable mirror; the definition stays the authority.
    enabled: row.enabled,
    key: row.loopKey,
    name: row.definition.name,
    repositoryFullName: row.repositoryFullName,
    triggerLabels: [...row.definition.triggers.issueLabels],
    validationGates: row.definition.validationGates.map((gate) => ({
      key: gate.key,
      name: gate.name,
      required: gate.required,
    })),
  }));
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

/**
 * Every GitHub setting key a successful read projects, and the single source of
 * truth for both `mapSettings` and `hasPortalProjectionIntegrity`.
 *
 * The `satisfies` clause requires one entry per `GitHubSettingKey`, so adding a
 * setting key without listing it here fails to compile.
 */
const githubSettingKeys = Object.keys({
  "issue-sync": true,
  "label-mapping": true,
  "pr-sync": true,
  "secret-redaction": true,
  sso: true,
  webhooks: true,
} satisfies Record<GitHubSettingKey, true>) as GitHubSettingKey[];

function mapSettings(input: {
  approvals: ApprovalRow[];
  installations: GithubInstallationRow[];
  loops: LoopRow[];
  runArtifacts: ArtifactRecord[];
}): GitHubSettingRecord[] {
  const hasLabels = input.loops.some(
    (loop) => loop.areaLabel || loop.milestone || loop.priorityLabel,
  );
  const hasPrArtifacts = input.runArtifacts.some((artifact) => artifact.label.includes("PR"));

  // Keyed by GitHubSettingKey so the projection stays exhaustive by construction:
  // adding a setting key without projecting it fails to compile, and the
  // projected key set can never drift from `githubSettingKeys` below.
  const projections: Record<GitHubSettingKey, Omit<GitHubSettingRecord, "key">> = {
    "issue-sync": {
      detail:
        input.loops.length > 0
          ? `${input.loops.length} synced issue loops are visible.`
          : "No issue loops are synced yet.",
      enabled: input.loops.length > 0,
      title: "Issue sync",
    },
    "label-mapping": {
      detail: hasLabels
        ? "Milestone, area, and priority labels are mapped into loop state."
        : "No milestone, area, or priority labels are mapped yet.",
      enabled: hasLabels,
      title: "Label mapping",
    },
    "pr-sync": {
      detail: hasPrArtifacts
        ? "PR intent artifacts are available from completed runs."
        : "No PR intent artifacts are available yet.",
      enabled: hasPrArtifacts,
      title: "PR sync",
    },
    "secret-redaction": {
      detail:
        input.approvals.length > 0
          ? "Approval summaries avoid token and credential material."
          : "No approval summaries are available to project redaction state yet.",
      enabled: input.approvals.length > 0,
      title: "Secret redaction",
    },
    sso: {
      detail:
        input.installations.length > 0
          ? `${input.installations.length} GitHub App installation${input.installations.length === 1 ? " is" : "s are"} connected.`
          : "No GitHub App installation is connected yet.",
      enabled: input.installations.length > 0,
      title: "GitHub SSO",
    },
    webhooks: {
      detail:
        input.loops.length > 0
          ? "Loop rows are available from issue synchronization."
          : "Webhook issue synchronization has not populated loops yet.",
      enabled: input.loops.length > 0,
      title: "Webhooks",
    },
  };

  return githubSettingKeys.map((key) =>
    setting(key, projections[key].title, projections[key].detail, projections[key].enabled),
  );
}

function fixturePortalRecords(): PortalRecords {
  return {
    approval: portalFixture.approval,
    artifacts: portalFixture.artifacts,
    deployments: portalFixture.deployments,
    githubInstallations: portalFixture.githubInstallations,
    githubSettings: portalFixture.githubSettings,
    loops: portalFixture.loops,
    registeredLoops: portalFixture.registeredLoops,
    repos: portalFixture.repos,
    timeline: portalFixture.timeline,
    validationResults: portalFixture.validationResults,
  };
}

function unavailablePortalRecords(): PortalRecords {
  // A fresh object per call: consumers receive these arrays directly, and the
  // shared module-level `emptyPortalRecords` would leak mutations across reads.
  return {
    approval: null,
    artifacts: [],
    deployments: [],
    githubInstallations: [],
    githubSettings: [],
    loops: [],
    registeredLoops: [],
    repos: [],
    timeline: [],
    validationResults: [],
  };
}

/**
 * Returns the requested collections that a surface declared it cannot render
 * without and that the store did not supply.
 *
 * A single global completeness check made every portal surface report
 * "Unavailable" on a fresh install, because loop registration (#126) leaves
 * `loops` empty and one empty collection discarded every record (#155). Each
 * surface now declares only what it actually needs.
 */
export function findUnmetPortalRequirements(
  records: PortalRecords,
  requires: readonly PortalDataRequirement[],
): PortalDataRequirement[] {
  return requires.filter((requirement) =>
    requirement === "approval" ? records.approval === null : records[requirement].length === 0,
  );
}

/**
 * The settings projection contract: a successful read carries a record for every
 * `githubSettingKeys` entry, whatever the database holds. Checks key presence,
 * not count.
 *
 * Asserted by tests over real reads, deliberately not at runtime. `mapSettings`
 * maps over the same list, so the compiler already guarantees this; a
 * production-only runtime check would be redundant and could only ever misfire,
 * reporting a healthy store as unavailable.
 */
export function hasPortalProjectionIntegrity(records: PortalRecords): boolean {
  const projected = new Set(records.githubSettings.map((record) => record.key));

  return githubSettingKeys.every((key) => projected.has(key));
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
  githubAppId?: number;
  now?: Date;
}): Promise<PortalRecordsResult> {
  const now = input.now ?? new Date();
  const [
    repositoryRows,
    githubInstallationRows,
    loopRows,
    loopDefinitionRows,
    vercelProjectRows,
    deploymentRowsResult,
    approvalRows,
    runResult,
  ] = await Promise.all([
    input.database.select().from(repositories).orderBy(asc(repositories.name)),
    input.database
      .select()
      .from(githubInstallations)
      .orderBy(asc(githubInstallations.accountLogin)),
    input.database.select().from(loops).orderBy(asc(loops.githubIssueNumber)),
    input.database
      .select({
        definition: loopDefinitions.definition,
        enabled: loopDefinitions.enabled,
        loopKey: loopDefinitions.loopKey,
        repositoryFullName: repositories.fullName,
      })
      .from(loopDefinitions)
      .innerJoin(repositories, eq(loopDefinitions.repositoryId, repositories.id))
      .orderBy(asc(repositories.fullName), asc(loopDefinitions.loopKey)),
    input.database.select().from(vercelProjects).orderBy(asc(vercelProjects.projectName)),
    input.database.select().from(deploymentRows).orderBy(desc(deploymentRows.createdAt)),
    input.database.select().from(approvals).orderBy(asc(approvals.requestedAt)),
    readRunRecords({
      database: input.database as RunRecordDatabase,
      now,
    }),
  ]);
  const activeGithubInstallationRows = githubInstallationRows.filter(
    (installation) => installation.appId === input.githubAppId,
  );
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
      githubInstallations: activeGithubInstallationRows.map((installation) => ({
        accountLogin: installation.accountLogin,
        accountType: installation.accountType,
        installationId: installation.installationId,
        repositorySelection: installation.repositorySelection,
      })),
      githubSettings: mapSettings({
        approvals: approvalRows,
        installations: activeGithubInstallationRows,
        loops: loopRows,
        runArtifacts: artifacts,
      }),
      loops: mapLoops(loopRows, runIssueCounts),
      registeredLoops: mapRegisteredLoops(loopDefinitionRows),
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
  /**
   * Required, not optional: a surface that omitted it would silently opt out of
   * failing closed. `[]` is a deliberate declaration that this surface renders
   * its own empty state.
   */
  requires: readonly PortalDataRequirement[];
}): Promise<PortalRecordsResult> {
  const env = input.env ?? process.env;
  if (
    !isProductionRuntime(env) &&
    readSuppliedRawConfig("LOOPWORKS_PORTAL_DATA_MODE", env) === "fixtures"
  ) {
    input.logger?.warn(
      { fallbackReason: "explicit_fixture_mode" },
      "portal_records_fixture_mode_enabled",
    );

    return {
      fallbackReason: "explicit_fixture_mode",
      records: fixturePortalRecords(),
      source: "fixtures",
      usedFallback: true,
    };
  }

  try {
    const githubAppId = Number(readSuppliedRawConfig("GITHUB_APP_ID", env));
    const hasValidGithubAppId = Number.isSafeInteger(githubAppId) && githubAppId > 0;
    if (isProductionRuntime(env) && !hasValidGithubAppId) {
      throw new Error("github_app_id_configuration_invalid");
    }
    const result = await readPortalRecords({
      database: input.database,
      githubAppId: hasValidGithubAppId ? githubAppId : undefined,
      now: input.now,
    });

    if (isProductionRuntime(env)) {
      const unmetRequirements = findUnmetPortalRequirements(result.records, input.requires);

      if (unmetRequirements.length > 0) {
        input.logger?.warn(
          {
            approvalCount: result.records.approval ? 1 : 0,
            deploymentCount: result.records.deployments.length,
            loopCount: result.records.loops.length,
            repositoryCount: result.records.repos.length,
            settingsCount: result.records.githubSettings.length,
            unmetRequirements,
          },
          "portal_records_required_data_missing",
        );

        return unavailableResult();
      }
    }

    return result;
  } catch (error) {
    input.logger?.warn(
      {
        err: error,
      },
      "portal_records_read_failed",
    );

    if (isProductionRuntime(env)) {
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
