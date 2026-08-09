import { cleanup, render, screen, within } from "@testing-library/react";

import { DashboardPageContent } from "@/app/(portal)/page";
import type { PortalRecords, PortalRecordsResult } from "@/lib/portal/records";

/**
 * PRD UX requirement 9: for an operator with no installation, no repos, or no loops, the *first
 * screen* must show the next activation step. #128's day-zero walk found the last stage missing:
 * with a tracked repository and no registered loop, the dashboard rendered an operational shell
 * that never named registration, so activation dead-ended on the one screen every operator lands
 * on after sign-in.
 */

function records(overrides: Partial<PortalRecords> = {}): PortalRecords {
  return {
    approval: null,
    artifacts: [],
    deployments: [],
    githubInstallations: [],
    githubSettings: [],
    loops: [],
    registeredLoops: [],
    repos: [],
    timeline: [],
    validationResults: [],
    ...overrides,
  };
}

function liveResult(overrides: Partial<PortalRecords> = {}): PortalRecordsResult {
  return { records: records(overrides), source: "db", usedFallback: false };
}

const installation: PortalRecords["githubInstallations"][number] = {
  accountLogin: "ncolesummers",
  accountType: "User",
  installationId: 800_000_101,
  repositorySelection: "selected",
};

const repo: PortalRecords["repos"][number] = {
  area: "portal",
  ciCommands: [],
  defaultBranch: "main",
  description: "The repository the day-zero walk tracks.",
  enabledLoops: [],
  framework: "Next.js",
  health: "healthy",
  lastSynced: "just now",
  milestone: "M4",
  name: "loopworks-day-zero",
  openIssues: 0,
  owner: "ncolesummers",
  priority: "p1",
  staleDays: 0,
  validationGates: [],
};

const registeredLoop: PortalRecords["registeredLoops"][number] = {
  approvalRequirements: [],
  enabled: true,
  key: "development-loop",
  name: "Agent-ready development loop",
  repositoryFullName: "ncolesummers/loopworks-day-zero",
  triggerLabels: [],
  validationGates: [],
};

describe("dashboard first-run activation step", () => {
  afterEach(() => {
    cleanup();
  });

  /**
   * The first two stages assert the requirement, not the panel that satisfies it: the catalog
   * already names them, and a second copy on the same screen would be a duplicate landmark.
   */
  it("names the installation step when nothing is connected", async () => {
    render(await DashboardPageContent({ result: liveResult() }));

    expect(screen.getAllByText("No GitHub App installation connected")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Connect the GitHub App" }).getAttribute("href")).toBe(
      "/api/github/install",
    );
    expect(screen.queryByRole("region", { name: "Next activation step" })).toBeNull();
  });

  it("names the repository step once an installation exists", async () => {
    render(
      await DashboardPageContent({ result: liveResult({ githubInstallations: [installation] }) }),
    );

    expect(screen.getAllByText("No repositories selected yet")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Select repositories" }).getAttribute("href")).toBe(
      "/settings/repositories",
    );
    expect(screen.queryByRole("region", { name: "Next activation step" })).toBeNull();
  });

  it("names the registration step once a repository is tracked", async () => {
    render(
      await DashboardPageContent({
        result: liveResult({ githubInstallations: [installation], repos: [repo] }),
      }),
    );

    const activation = screen.getByRole("region", { name: "Next activation step" });
    expect(within(activation).getByText("No loops registered")).toBeTruthy();
    expect(
      within(activation).getByRole("link", { name: "Register a loop" }).getAttribute("href"),
    ).toBe("/loops/register");
  });

  it("drops the activation step once a loop is registered", async () => {
    render(
      await DashboardPageContent({
        result: liveResult({
          githubInstallations: [installation],
          registeredLoops: [registeredLoop],
          repos: [repo],
        }),
      }),
    );

    expect(screen.queryByRole("region", { name: "Next activation step" })).toBeNull();
  });

  it("offers no activation step when the read failed, which is not a verified absence", async () => {
    render(
      await DashboardPageContent({
        result: {
          error: "read_failed",
          records: records(),
          source: "unavailable" as const,
          usedFallback: false,
        },
      }),
    );

    expect(screen.queryByRole("region", { name: "Next activation step" })).toBeNull();
  });
});
