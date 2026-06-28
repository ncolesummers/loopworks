import { createVercelDeploymentClient, mapVercelDeployment } from "@/lib/vercel/client";
import type { LoopworksLogger } from "@/lib/observability/logger";

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
});
