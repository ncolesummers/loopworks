import type { Status } from "@/components/ui/status-badge";
import type {
  ApprovalState,
  ArtifactState,
  DeploymentState,
  LoopRegistryItem,
  LoopState,
  RepoHealth,
  TimelineKind,
  ValidationResultState,
} from "@/lib/types";
import type { DeploymentSummaryStatus } from "@/lib/vercel/types";

export interface PortalStatusMeta {
  status: Status;
  label: string;
}

export function getRepoHealthStatus(health: RepoHealth): PortalStatusMeta {
  const statuses = {
    healthy: { status: "ready", label: "Healthy" },
    watch: { status: "blocked", label: "Watch" },
    blocked: { status: "blocked", label: "Blocked" },
    disconnected: { status: "disabled", label: "Disconnected" },
  } satisfies Record<RepoHealth, PortalStatusMeta>;

  return statuses[health];
}

export function getDeploymentStatus(
  state: DeploymentState | DeploymentSummaryStatus,
): PortalStatusMeta {
  const statuses = {
    success: { status: "ready", label: "Ready" },
    preview: { status: "preview", label: "Preview" },
    queued: { status: "queued", label: "Queued" },
    failed: { status: "errored", label: "Errored" },
    building: { status: "building", label: "Building" },
    ready: { status: "ready", label: "Ready" },
    error: { status: "errored", label: "Errored" },
    canceled: { status: "canceled", label: "Canceled" },
  } satisfies Record<DeploymentState | DeploymentSummaryStatus, PortalStatusMeta>;

  return statuses[state];
}

export function getLoopEnabledStatus(enabled: boolean): PortalStatusMeta {
  return enabled ? { status: "ready", label: "Enabled" } : { status: "disabled", label: "Paused" };
}

export function getLoopStateStatus(state: LoopState): PortalStatusMeta {
  const statuses = {
    Intake: { status: "pending", label: "Intake" },
    Triage: { status: "pending", label: "Triage" },
    Planned: { status: "queued", label: "Planned" },
    "In Progress": { status: "running", label: "In Progress" },
    "Waiting on Review": { status: "needsApproval", label: "Waiting on Review" },
    Validating: { status: "running", label: "Validating" },
    Blocked: { status: "blocked", label: "Blocked" },
    Done: { status: "done", label: "Done" },
  } satisfies Record<LoopState, PortalStatusMeta>;

  return statuses[state];
}

export function getLoopRiskStatus(risk: LoopRegistryItem["risk"]): PortalStatusMeta {
  const statuses = {
    low: { status: "ready", label: "Low risk" },
    medium: { status: "blocked", label: "Medium risk" },
    high: { status: "blocked", label: "High risk" },
  } satisfies Record<LoopRegistryItem["risk"], PortalStatusMeta>;

  return statuses[risk];
}

export function getApprovalStatus(state: ApprovalState): PortalStatusMeta {
  const statuses = {
    requested: { status: "needsApproval", label: "Requested" },
    ready: { status: "ready", label: "Ready" },
    "needs-review": { status: "needsApproval", label: "Needs Approval" },
    approved: { status: "approved", label: "Approved" },
    rejected: { status: "rejected", label: "Rejected" },
    bypassed: { status: "skipped", label: "Bypassed" },
    expired: { status: "blocked", label: "Expired" },
    blocked: { status: "blocked", label: "Blocked" },
  } satisfies Record<ApprovalState, PortalStatusMeta>;

  return statuses[state];
}

export function getApprovalChecklistStatus(done: boolean): PortalStatusMeta {
  return done
    ? { status: "approved", label: "Verified" }
    : { status: "needsApproval", label: "Needs Review" };
}

export function getValidationResultStatus(state: ValidationResultState): PortalStatusMeta {
  const statuses = {
    passed: { status: "succeeded", label: "Passed" },
    warning: { status: "blocked", label: "Warnings" },
    failed: { status: "failed", label: "Failed" },
    running: { status: "running", label: "Running" },
    skipped: { status: "skipped", label: "Skipped" },
  } satisfies Record<ValidationResultState, PortalStatusMeta>;

  return statuses[state];
}

export function getArtifactStatus(state: ArtifactState): PortalStatusMeta {
  const statuses = {
    available: { status: "ready", label: "Available" },
    pending: { status: "queued", label: "Pending" },
    failed: { status: "failed", label: "Failed" },
  } satisfies Record<ArtifactState, PortalStatusMeta>;

  return statuses[state];
}

export function getTimelineKindStatus(kind: TimelineKind): PortalStatusMeta {
  const statuses = {
    sync: { status: "done", label: "Sync" },
    state: { status: "running", label: "State" },
    artifact: { status: "ready", label: "Artifact" },
    approval: { status: "needsApproval", label: "Approval" },
    planning: { status: "pending", label: "Planning" },
    test: { status: "running", label: "Test" },
    development: { status: "running", label: "Development" },
    validation: { status: "succeeded", label: "Validation" },
    review: { status: "needsApproval", label: "Review" },
    commit: { status: "done", label: "Commit" },
    pull_request: { status: "preview", label: "PR" },
    done: { status: "done", label: "Done" },
  } satisfies Record<TimelineKind, PortalStatusMeta>;

  return statuses[kind];
}

export function getEnabledStatus(enabled: boolean): PortalStatusMeta {
  return enabled
    ? { status: "ready", label: "Enabled" }
    : { status: "disabled", label: "Disabled" };
}
