import type { DeploymentRecord } from "@/lib/types";

import type { VercelDeploymentListResult, VercelDeploymentSummary } from "./types";

function formatAge(createdAt: string, now: Date): string {
  const created = new Date(createdAt).getTime();
  const diffMs = Math.max(0, now.getTime() - created);
  const diffMinutes = Math.max(1, Math.floor(diffMs / 60_000));

  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  return `${Math.floor(diffHours / 24)}d`;
}

function shortSha(commitSha: string | undefined): string | undefined {
  return commitSha && commitSha !== "pending" ? commitSha.slice(0, 7) : commitSha;
}

function deploymentChecks(deployment: VercelDeploymentSummary): string[] {
  switch (deployment.status) {
    case "ready":
      return [
        deployment.environment === "production" ? "Build ready" : "Preview ready",
        deployment.readyAt ? "Runtime logs clean" : "Ready state confirmed",
      ];
    case "building":
      return ["Build started"];
    case "error":
      return ["Build failed"];
    case "queued":
      return ["Waiting for upload", "Awaiting preview URL"];
    case "canceled":
      return ["Deployment canceled"];
  }
}

export function mapVercelSummaryToDeploymentRecord(
  deployment: VercelDeploymentSummary,
  now = new Date(),
): DeploymentRecord {
  return {
    name: `${deployment.environment}/${deployment.branch ?? deployment.projectName}`,
    state: deployment.status,
    environment: deployment.environment,
    ...(deployment.branch ? { branch: deployment.branch } : {}),
    ...(deployment.commitSha ? { sha: shortSha(deployment.commitSha) } : {}),
    ...(deployment.url ? { url: deployment.url } : {}),
    age: formatAge(deployment.createdAt, now),
    checks: deploymentChecks(deployment),
    ...(deployment.inspectorUrl ? { inspectorUrl: deployment.inspectorUrl } : {}),
  };
}

export function getDeploymentRecordsForResult(
  result: VercelDeploymentListResult,
  fixtureDeployments: DeploymentRecord[],
  now = new Date(),
): DeploymentRecord[] {
  if (result.source === "fixtures") {
    return fixtureDeployments;
  }

  if (result.source === "unavailable") {
    return [];
  }

  return result.deployments.map((deployment) =>
    mapVercelSummaryToDeploymentRecord(deployment, now),
  );
}

export function getDeploymentSourceLabel(result: VercelDeploymentListResult): string {
  if (result.source === "api") {
    return "Live Vercel";
  }

  if (result.source === "fixtures") {
    return "Fixture fallback";
  }

  return "Unavailable";
}
