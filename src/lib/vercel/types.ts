export const deploymentSummaryStatusValues = [
  "queued",
  "building",
  "ready",
  "error",
  "canceled",
] as const;

export type DeploymentSummaryStatus = (typeof deploymentSummaryStatusValues)[number];

export type VercelDeploymentPayload = {
  uid: string;
  name: string;
  url?: string | null;
  state?: string | null;
  readyState?: string | null;
  createdAt: number;
  ready?: number | null;
  target?: string | null;
  alias?: string[] | null;
  inspectorUrl?: string | null;
  projectId?: string | null;
  meta?: Record<string, string | undefined> | null;
  creator?: {
    username?: string | null;
  } | null;
  gitSource?: {
    type?: string | null;
    ref?: string | null;
    sha?: string | null;
    repo?: string | null;
    org?: string | null;
    prId?: number | string | null;
  } | null;
};

export type VercelDeploymentSummary = {
  id: string;
  projectId?: string;
  projectName: string;
  environment: "production" | "preview" | "development";
  status: DeploymentSummaryStatus;
  url?: string;
  branch?: string;
  commitSha?: string;
  createdAt: string;
  readyAt?: string;
  creator?: string;
  inspectorUrl?: string;
  aliasUrls: string[];
  issueNumbers: number[];
  pullRequestNumber?: number;
};

export type VercelDeploymentListResult = {
  source: "api" | "fixtures" | "unavailable";
  usedFallback: boolean;
  fallbackReason?: string;
  error?: string;
  deployments: VercelDeploymentSummary[];
};
