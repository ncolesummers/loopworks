import type { LoopworksLogger } from "@/lib/observability/logger";

import { vercelDeploymentFixtures } from "./fixtures";
import type {
  DeploymentSummaryStatus,
  VercelDeploymentListResult,
  VercelDeploymentPayload,
  VercelDeploymentSummary,
} from "./types";

export type VercelDeploymentClientConfig = {
  accessToken?: string;
  teamId?: string;
  teamSlug?: string;
  apiBaseUrl?: string;
  preferFixtures?: boolean;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  logger?: LoopworksLogger;
};

function normalizeState(
  state: string | null | undefined,
  readyState: string | null | undefined,
): DeploymentSummaryStatus {
  const candidate = (readyState ?? state ?? "").trim().toUpperCase();

  switch (candidate) {
    case "CANCELED":
      return "canceled";
    case "ERROR":
      return "error";
    case "INITIALIZING":
    case "QUEUED":
      return "queued";
    case "READY":
      return "ready";
    default:
      return "building";
  }
}

function normalizeEnvironment(
  target: string | null | undefined,
): "production" | "preview" | "development" {
  const normalized = (target ?? "").trim().toLowerCase();

  if (normalized === "production") {
    return "production";
  }

  if (normalized === "development") {
    return "development";
  }

  return "preview";
}

function toIsoDate(timestamp: number | null | undefined): string | undefined {
  if (!timestamp) {
    return undefined;
  }

  return new Date(timestamp).toISOString();
}

function toHttpsUrl(value: string): string {
  return value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
}

function extractIssueNumbers(input: string | null | undefined): number[] {
  if (!input) {
    return [];
  }

  if (/^\d+$/.test(input.trim())) {
    return [Number.parseInt(input.trim(), 10)];
  }

  const matches = input.matchAll(/(?:^|[^\d])(?:issue[-/_#]?|issues[-/_#]?|#)(\d+)(?=$|[^\d])/gi);
  const numbers = new Set<number>();

  for (const match of matches) {
    const candidate = Number.parseInt(match[1] ?? "", 10);
    if (Number.isInteger(candidate) && candidate > 0) {
      numbers.add(candidate);
    }
  }

  return [...numbers].sort((left, right) => left - right);
}

function extractPullRequestNumber(payload: VercelDeploymentPayload): number | undefined {
  const rawValue = payload.meta?.githubPullRequestId ?? payload.gitSource?.prId;
  if (rawValue === undefined || rawValue === null) {
    return undefined;
  }

  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function mapVercelDeployment(payload: VercelDeploymentPayload): VercelDeploymentSummary {
  const branch = payload.gitSource?.ref ?? payload.meta?.githubCommitRef;
  const commitSha = payload.gitSource?.sha ?? payload.meta?.githubCommitSha;
  const readyAt = toIsoDate(payload.ready);
  const pullRequestNumber = extractPullRequestNumber(payload);
  const issueNumbers = [
    ...new Set([
      ...extractIssueNumbers(payload.meta?.loopworksIssue),
      ...extractIssueNumbers(branch),
    ]),
  ];

  return {
    id: payload.uid,
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
    projectName: payload.name,
    environment: normalizeEnvironment(payload.target),
    status: normalizeState(payload.state, payload.readyState),
    url: toHttpsUrl(payload.url),
    ...(branch ? { branch } : {}),
    ...(commitSha ? { commitSha } : {}),
    createdAt: new Date(payload.createdAt).toISOString(),
    ...(readyAt ? { readyAt } : {}),
    ...(payload.creator?.username ? { creator: payload.creator.username } : {}),
    ...(payload.inspectorUrl ? { inspectorUrl: payload.inspectorUrl } : {}),
    aliasUrls: (payload.alias ?? []).map(toHttpsUrl),
    issueNumbers,
    ...(pullRequestNumber ? { pullRequestNumber } : {}),
  };
}

function buildDeploymentsUrl(input: {
  apiBaseUrl: string;
  projectId: string;
  teamId?: string;
  teamSlug?: string;
  limit: number;
}): string {
  const url = new URL(`/v6/deployments`, input.apiBaseUrl);
  url.searchParams.set("projectId", input.projectId);
  url.searchParams.set("limit", String(input.limit));

  if (input.teamId) {
    url.searchParams.set("teamId", input.teamId);
  }

  if (input.teamSlug) {
    url.searchParams.set("slug", input.teamSlug);
  }

  return url.toString();
}

function mapFixtureResult(reason: string, logger?: LoopworksLogger): VercelDeploymentListResult {
  logger?.warn(
    {
      reason,
      deploymentCount: vercelDeploymentFixtures.length,
    },
    "vercel_deployments_fixture_fallback",
  );

  return {
    source: "fixtures",
    usedFallback: true,
    fallbackReason: reason,
    deployments: vercelDeploymentFixtures.map(mapVercelDeployment),
  };
}

export function createVercelDeploymentClient(config: VercelDeploymentClientConfig = {}) {
  return {
    async listDeployments(input: {
      projectId?: string | null;
      limit?: number;
    }): Promise<VercelDeploymentListResult> {
      const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
      const log = config.logger?.child({
        vercelProjectId: input.projectId,
        limit,
      });

      if (config.preferFixtures) {
        return mapFixtureResult("prefer_fixtures", log);
      }

      if (!config.accessToken) {
        return mapFixtureResult("missing_access_token", log);
      }

      if (!input.projectId) {
        return mapFixtureResult("missing_project_id", log);
      }

      const fetchImpl = config.fetchImpl ?? fetch;
      const url = buildDeploymentsUrl({
        apiBaseUrl: config.apiBaseUrl ?? "https://api.vercel.com",
        projectId: input.projectId,
        teamId: config.teamId,
        teamSlug: config.teamSlug,
        limit,
      });

      try {
        const response = await fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
          },
        });

        if (!response.ok) {
          log?.warn(
            {
              status: response.status,
            },
            "vercel_deployments_api_error",
          );
          return mapFixtureResult("api_response_not_ok", log);
        }

        const body = (await response.json()) as {
          deployments?: VercelDeploymentPayload[];
        };

        log?.info(
          {
            deploymentCount: body.deployments?.length ?? 0,
          },
          "vercel_deployments_api_success",
        );

        return {
          source: "api",
          usedFallback: false,
          deployments: (body.deployments ?? []).map(mapVercelDeployment),
        };
      } catch (error) {
        log?.error(
          {
            err: error,
          },
          "vercel_deployments_api_exception",
        );
        return mapFixtureResult("api_exception", log);
      }
    },
  };
}
