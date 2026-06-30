import { createVercelDeploymentClient, mapVercelDeployment } from "@/lib/vercel/client";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { vercelDeploymentFixtures } from "@/lib/vercel/fixtures";
import type { DeploymentSummaryStatus, VercelDeploymentPayload } from "@/lib/vercel/types";

function createMockLogger() {
  const logger = {
    child: vi.fn(() => logger),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return logger as unknown as LoopworksLogger & {
    child: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

describe("Vercel deployment helpers", () => {
  it("maps a deployment payload into a summary", () => {
    const summary = mapVercelDeployment({
      uid: "dpl_123",
      name: "loopworks",
      projectId: "prj_loopworks",
      url: "loopworks-git-issue-77.vercel.app",
      state: "READY",
      readyState: "READY",
      createdAt: Date.parse("2026-06-18T18:05:00.000Z"),
      ready: Date.parse("2026-06-18T18:07:12.000Z"),
      target: "preview",
      alias: ["loopworks-preview-77.vercel.app"],
      meta: {
        githubCommitRef: "issue-77-agent-ready",
        githubCommitSha: "abc123",
        githubPullRequestId: "11",
        loopworksIssue: "77",
      },
      gitSource: {
        ref: "issue-77-agent-ready",
        sha: "abc123",
        prId: 11,
      },
      creator: {
        username: "eve-agent",
      },
    });

    expect(summary).toMatchObject({
      id: "dpl_123",
      projectId: "prj_loopworks",
      projectName: "loopworks",
      environment: "preview",
      status: "ready",
      branch: "issue-77-agent-ready",
      commitSha: "abc123",
      creator: "eve-agent",
      issueNumbers: [77],
      pullRequestNumber: 11,
    });
    expect(summary.url).toBe("https://loopworks-git-issue-77.vercel.app");
  });

  it("normalizes Vercel states and meta-only commit metadata", () => {
    const cases = [
      { state: "READY", readyState: "READY", expectedStatus: "ready" },
      { state: "BUILDING", readyState: "BUILDING", expectedStatus: "building" },
      { state: "ERROR", readyState: "ERROR", expectedStatus: "error" },
      { state: "QUEUED", readyState: "QUEUED", expectedStatus: "queued" },
      { state: "CANCELED", readyState: "CANCELED", expectedStatus: "canceled" },
    ] satisfies {
      state: string;
      readyState: string;
      expectedStatus: DeploymentSummaryStatus;
    }[];

    for (const item of cases) {
      const summary = mapVercelDeployment({
        uid: `dpl_${item.expectedStatus}`,
        name: "loopworks",
        url: `loopworks-${item.expectedStatus}.vercel.app`,
        state: item.state,
        readyState: item.readyState,
        createdAt: Date.parse("2026-06-18T18:05:00.000Z"),
        target: item.expectedStatus === "ready" ? "production" : "preview",
        meta: {
          githubCommitRef: `codex/${item.expectedStatus}`,
          githubCommitSha: `${item.expectedStatus}123`,
        },
      });

      expect(summary.status).toBe(item.expectedStatus);
      expect(summary.branch).toBe(`codex/${item.expectedStatus}`);
      expect(summary.commitSha).toBe(`${item.expectedStatus}123`);
    }
  });

  it("preserves missing deployment URLs for queued builds", () => {
    const summary = mapVercelDeployment({
      uid: "dpl_queued_without_url",
      name: "loopworks",
      url: null,
      state: "QUEUED",
      readyState: "QUEUED",
      createdAt: Date.parse("2026-06-18T18:05:00.000Z"),
      target: "preview",
      gitSource: {
        ref: "codex/9-vercel-deploy",
        sha: "pending",
      },
    } as VercelDeploymentPayload);

    expect(summary.status).toBe("queued");
    expect(summary.url).toBeUndefined();
  });

  it("keeps fixture deployments broad enough for the Issue #9 overview", () => {
    const summaries = vercelDeploymentFixtures.map(mapVercelDeployment);

    expect(summaries.map((summary) => summary.status)).toEqual(
      expect.arrayContaining(["ready", "building", "error"]),
    );
    expect(summaries.map((summary) => summary.environment)).toEqual(
      expect.arrayContaining(["preview", "production"]),
    );
  });

  it("falls back to fixtures when credentials are missing", async () => {
    const logger = createMockLogger();
    const client = createVercelDeploymentClient({
      logger,
    });
    const result = await client.listDeployments({
      projectId: null,
    });

    expect(result.source).toBe("fixtures");
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("missing_access_token");
    expect(result.deployments.length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_access_token",
      }),
      "vercel_deployments_fixture_fallback",
    );
  });

  it("does not silently return deployment fixtures in production", async () => {
    const logger = createMockLogger();
    const client = createVercelDeploymentClient({
      env: {
        NODE_ENV: "production",
      },
      logger,
    });
    const result = await client.listDeployments({
      projectId: null,
    });

    expect(result).toEqual({
      source: "unavailable",
      usedFallback: false,
      fallbackReason: "missing_access_token",
      error: "Vercel deployment credentials are required in production.",
      deployments: [],
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "missing_access_token",
      }),
      "vercel_deployments_unavailable",
    );
  });

  it("uses API data when fetch succeeds", async () => {
    const logger = createMockLogger();
    const client = createVercelDeploymentClient({
      accessToken: "token",
      logger,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            deployments: [
              {
                uid: "dpl_api",
                name: "loopworks",
                url: "loopworks-api.vercel.app",
                state: "BUILDING",
                createdAt: Date.parse("2026-06-18T18:05:00.000Z"),
                target: "production",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
    });

    const result = await client.listDeployments({
      projectId: "prj_loopworks",
    });

    expect(result).toEqual({
      source: "api",
      usedFallback: false,
      deployments: [
        {
          aliasUrls: [],
          createdAt: "2026-06-18T18:05:00.000Z",
          environment: "production",
          id: "dpl_api",
          projectName: "loopworks",
          status: "building",
          url: "https://loopworks-api.vercel.app",
          issueNumbers: [],
        },
      ],
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentCount: 1,
      }),
      "vercel_deployments_api_success",
    );
  });

  it("requests the Vercel deployments endpoint with project and team scope", async () => {
    const logger = createMockLogger();
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const client = createVercelDeploymentClient({
      accessToken: "token",
      teamId: "team_loopworks",
      teamSlug: "loopworks-team",
      apiBaseUrl: "https://api.vercel.test",
      logger,
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      },
    });

    await client.listDeployments({
      projectId: "prj_loopworks",
      limit: 100,
    });

    expect(requestedUrl).toBe(
      "https://api.vercel.test/v7/deployments?projectId=prj_loopworks&limit=50&teamId=team_loopworks&slug=loopworks-team",
    );
    expect(requestedInit?.headers).toEqual({
      Authorization: "Bearer token",
    });
  });
});
