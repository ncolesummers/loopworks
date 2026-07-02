import {
  getApprovalChecklistStatus,
  getApprovalStatus,
  getArtifactStatus,
  getDeploymentEnvironmentStatus,
  getDeploymentStatus,
  getLoopEnabledStatus,
  getLoopStateStatus,
  getRepoHealthStatus,
  getRunStatus,
  getRunStepStatus,
  getValidationResultStatus,
} from "@/components/portal/status-mapping";

describe("portal status mapping", () => {
  it("maps repo health into the shared status vocabulary", () => {
    expect(getRepoHealthStatus("healthy")).toEqual({ status: "ready", label: "Healthy" });
    expect(getRepoHealthStatus("watch")).toEqual({ status: "blocked", label: "Watch" });
    expect(getRepoHealthStatus("blocked")).toEqual({ status: "blocked", label: "Blocked" });
    expect(getRepoHealthStatus("disconnected")).toEqual({
      status: "disabled",
      label: "Disconnected",
    });
  });

  it("maps deployment state into deployment statuses", () => {
    expect(getDeploymentStatus("queued")).toEqual({ status: "queued", label: "Queued" });
    expect(getDeploymentStatus("building")).toEqual({ status: "building", label: "Building" });
    expect(getDeploymentStatus("ready")).toEqual({ status: "ready", label: "Ready" });
    expect(getDeploymentStatus("error")).toEqual({ status: "errored", label: "Errored" });
    expect(getDeploymentStatus("canceled")).toEqual({ status: "canceled", label: "Canceled" });
    expect(getDeploymentEnvironmentStatus("production")).toEqual({
      status: "production",
      label: "Production",
    });
    expect(getDeploymentEnvironmentStatus("preview")).toEqual({
      status: "preview",
      label: "Preview",
    });
    expect(getDeploymentEnvironmentStatus("development")).toEqual({
      status: "running",
      label: "Development",
    });
  });

  it("maps loop enabled and workflow states", () => {
    expect(getLoopEnabledStatus(true)).toEqual({ status: "ready", label: "Enabled" });
    expect(getLoopEnabledStatus(false)).toEqual({ status: "disabled", label: "Paused" });
    expect(getLoopStateStatus("Triage")).toEqual({ status: "pending", label: "Triage" });
    expect(getLoopStateStatus("In Progress")).toEqual({
      status: "running",
      label: "In Progress",
    });
    expect(getLoopStateStatus("Waiting on Review")).toEqual({
      status: "needsApproval",
      label: "Waiting on Review",
    });
    expect(getLoopStateStatus("Blocked")).toEqual({ status: "blocked", label: "Blocked" });
    expect(getLoopStateStatus("Done")).toEqual({ status: "done", label: "Done" });
  });

  it("maps approval and checklist states", () => {
    expect(getApprovalStatus("requested")).toEqual({
      status: "needsApproval",
      label: "Requested",
    });
    expect(getApprovalStatus("ready")).toEqual({ status: "ready", label: "Ready" });
    expect(getApprovalStatus("approved")).toEqual({ status: "approved", label: "Approved" });
    expect(getApprovalStatus("rejected")).toEqual({ status: "rejected", label: "Rejected" });
    expect(getApprovalStatus("bypassed")).toEqual({ status: "skipped", label: "Bypassed" });
    expect(getApprovalStatus("expired")).toEqual({ status: "blocked", label: "Expired" });
    expect(getApprovalStatus("needs-review")).toEqual({
      status: "needsApproval",
      label: "Needs Approval",
    });
    expect(getApprovalStatus("blocked")).toEqual({ status: "blocked", label: "Blocked" });
    expect(getApprovalChecklistStatus(true)).toEqual({ status: "approved", label: "Verified" });
    expect(getApprovalChecklistStatus(false)).toEqual({
      status: "needsApproval",
      label: "Needs Review",
    });
  });

  it("maps validation and artifact states", () => {
    expect(getValidationResultStatus("passed")).toEqual({
      status: "succeeded",
      label: "Passed",
    });
    expect(getValidationResultStatus("warning")).toEqual({
      status: "blocked",
      label: "Warnings",
    });
    expect(getValidationResultStatus("failed")).toEqual({ status: "failed", label: "Failed" });
    expect(getValidationResultStatus("skipped")).toEqual({
      status: "skipped",
      label: "Skipped",
    });
    expect(getArtifactStatus("available")).toEqual({ status: "ready", label: "Available" });
    expect(getArtifactStatus("pending")).toEqual({ status: "queued", label: "Pending" });
    expect(getArtifactStatus("failed")).toEqual({ status: "failed", label: "Failed" });
  });

  it("maps run and step states", () => {
    expect(getRunStatus("waiting_for_approval")).toEqual({
      status: "needsApproval",
      label: "Waiting Approval",
    });
    expect(getRunStatus("blocked")).toEqual({ status: "blocked", label: "Blocked" });
    expect(getRunStepStatus("running")).toEqual({ status: "running", label: "Running" });
    expect(getRunStepStatus("succeeded")).toEqual({
      status: "succeeded",
      label: "Succeeded",
    });
  });
});
