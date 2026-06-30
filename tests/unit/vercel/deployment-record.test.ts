import {
  getDeploymentRecordsForResult,
  getDeploymentSourceLabel,
  mapVercelSummaryToDeploymentRecord,
} from "@/lib/vercel/deployment-record";
import type { DeploymentRecord } from "@/lib/types";
import type { VercelDeploymentListResult, VercelDeploymentSummary } from "@/lib/vercel/types";

const now = new Date("2026-06-18T21:05:00.000Z");

describe("Vercel deployment record mapping", () => {
  it("maps live Vercel summaries into portal deployment records", () => {
    const deployment: VercelDeploymentSummary = {
      id: "dpl_live",
      projectName: "loopworks",
      environment: "production",
      status: "ready",
      url: "https://loopworks.vercel.app",
      branch: "main",
      commitSha: "7ad2f90abcdef",
      createdAt: "2026-06-18T20:05:00.000Z",
      readyAt: "2026-06-18T20:07:00.000Z",
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_live",
      aliasUrls: [],
      issueNumbers: [],
    };

    expect(mapVercelSummaryToDeploymentRecord(deployment, now)).toEqual({
      name: "production/main",
      state: "ready",
      environment: "production",
      branch: "main",
      sha: "7ad2f90",
      url: "https://loopworks.vercel.app",
      age: "1h",
      checks: ["Build ready", "Runtime logs clean"],
      inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_live",
    });
  });

  it("keeps fixture fallback explicit without using fixtures for unavailable production data", () => {
    const fixtureDeployments: DeploymentRecord[] = [
      {
        name: "preview/fixture",
        state: "ready",
        environment: "preview",
        branch: "fixture",
        sha: "abc1234",
        url: "https://loopworks-git-fixture.vercel.app",
        age: "2m",
        checks: ["Preview ready"],
      },
    ];
    const fixtureResult: VercelDeploymentListResult = {
      source: "fixtures",
      usedFallback: true,
      fallbackReason: "missing_access_token",
      deployments: [],
    };
    const unavailableResult: VercelDeploymentListResult = {
      source: "unavailable",
      usedFallback: false,
      fallbackReason: "missing_access_token",
      error: "Vercel deployment credentials are required in production.",
      deployments: [],
    };

    expect(getDeploymentRecordsForResult(fixtureResult, fixtureDeployments, now)).toBe(
      fixtureDeployments,
    );
    expect(getDeploymentSourceLabel(fixtureResult)).toBe("Fixture fallback");
    expect(getDeploymentRecordsForResult(unavailableResult, fixtureDeployments, now)).toEqual([]);
    expect(getDeploymentSourceLabel(unavailableResult)).toBe("Unavailable");
  });
});
