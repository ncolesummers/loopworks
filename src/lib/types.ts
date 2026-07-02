import type { ApprovalStatus } from "@/lib/approvals";

export type RepoHealth = "healthy" | "watch" | "blocked" | "disconnected";

export type DeploymentState = "queued" | "building" | "ready" | "error" | "canceled";

export type DeploymentEnvironment = "production" | "preview" | "development";

export type LoopState =
  | "Intake"
  | "Triage"
  | "Planned"
  | "In Progress"
  | "Waiting on Review"
  | "Validating"
  | "Blocked"
  | "Done";

export type ApprovalState =
  | "requested"
  | "ready"
  | "needs-review"
  | "approved"
  | "rejected"
  | "bypassed"
  | "expired"
  | "blocked"
  | "cancelled"
  | "applied";

export type TimelineKind =
  | "sync"
  | "state"
  | "artifact"
  | "approval"
  | "planning"
  | "test"
  | "development"
  | "validation"
  | "review"
  | "commit"
  | "pull_request"
  | "done";

export type ArtifactState = "available" | "pending" | "failed";

export type ArtifactKind = "preview" | "validation" | "review" | "log";

export type ValidationResultState = "passed" | "warning" | "failed" | "running" | "skipped";

export type GitHubSettingKey =
  | "sso"
  | "webhooks"
  | "issue-sync"
  | "pr-sync"
  | "label-mapping"
  | "secret-redaction";

export interface RepoRecord {
  name: string;
  owner: string;
  description: string;
  health: RepoHealth;
  githubHref?: string;
  framework: string;
  defaultBranch: string;
  ciCommands: string[];
  docsHref?: string;
  observabilityHref?: string;
  designSystemHref?: string;
  enabledLoops: string[];
  validationGates: string[];
  vercelProjectId?: string;
  vercelProjectHref?: string;
  milestone: string;
  area: string;
  priority: string;
  openIssues: number;
  staleDays: number;
  lastSynced: string;
}

export interface DeploymentRecord {
  name: string;
  state: DeploymentState;
  environment: DeploymentEnvironment;
  branch?: string;
  sha?: string;
  url?: string;
  age: string;
  checks: string[];
  inspectorUrl?: string;
}

export interface LoopRegistryItem {
  name: string;
  state: LoopState;
  enabled: boolean;
  owner: string;
  queueDepth: number;
  risk: "low" | "medium" | "high";
  skippedReason?: string;
}

export interface TimelineEvent {
  id?: string;
  kind: TimelineKind;
  at: string;
  actor: string;
  title: string;
  detail: string;
  artifact?: string;
  status?: RunStepStatus;
  validationCommand?: string;
  validationStatus?: string;
}

export interface ArtifactRecord {
  label: string;
  href: string;
  detail: string;
  state: ArtifactState;
  kind: ArtifactKind;
}

export interface ValidationResultRecord {
  name: string;
  command: string;
  status: ValidationResultState;
  duration: string;
  detail: string;
  artifactHref?: string;
}

export interface ApprovalChecklistItem {
  label: string;
  done: boolean;
}

export interface ApprovalGateRecord {
  state: ApprovalState;
  owner: string;
  due: string;
  risk: string;
  checklist: ApprovalChecklistItem[];
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "blocked"
  | "failed"
  | "succeeded"
  | "canceled";

export type RunStepStatus = "queued" | "running" | "skipped" | "failed" | "succeeded";

export interface RunApprovalRecord {
  id: string;
  note?: string;
  requestedAt: string;
  requestedBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
  scope: string;
  status: ApprovalStatus;
}

export interface RunRecord {
  age: string;
  approvals: RunApprovalRecord[];
  artifacts: ArtifactRecord[];
  blockedReason?: string;
  currentStage: string;
  id: string;
  issue?: string;
  issueHref?: string;
  loopKey: string;
  priorityLabel: string;
  queuedAt: string;
  repositoryFullName: string;
  status: RunStatus;
  steps: TimelineEvent[];
}

export interface GitHubSettingRecord {
  key: GitHubSettingKey;
  title: string;
  detail: string;
  enabled: boolean;
}

export interface FixtureState {
  repos: RepoRecord[];
  deployments: DeploymentRecord[];
  loops: LoopRegistryItem[];
  timeline: TimelineEvent[];
  artifacts: ArtifactRecord[];
  validationResults: ValidationResultRecord[];
  approval: ApprovalGateRecord;
  runs: RunRecord[];
  githubSettings: GitHubSettingRecord[];
}
