export type RepoHealth = "healthy" | "watch" | "blocked";

export type DeploymentState = "success" | "preview" | "queued" | "failed";

export type LoopState =
  | "Intake"
  | "Triage"
  | "Planned"
  | "In Progress"
  | "Waiting on Review"
  | "Validating"
  | "Blocked"
  | "Done";

export type ApprovalState = "ready" | "needs-review" | "blocked";

export type TimelineKind = "sync" | "state" | "artifact" | "approval";

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
  environment: string;
  branch: string;
  sha: string;
  url: string;
  age: string;
  checks: string[];
}

export interface LoopRegistryItem {
  name: string;
  state: LoopState;
  enabled: boolean;
  owner: string;
  queueDepth: number;
  risk: "low" | "medium" | "high";
}

export interface TimelineEvent {
  kind: TimelineKind;
  at: string;
  actor: string;
  title: string;
  detail: string;
  artifact?: string;
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
  approval: ApprovalGateRecord;
  githubSettings: GitHubSettingRecord[];
}
