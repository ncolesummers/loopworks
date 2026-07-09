import { cleanup, render, screen } from "@testing-library/react";

import { ApprovalsPageContent } from "@/app/(portal)/approvals/page";
import { CatalogPageContent } from "@/app/(portal)/catalog/page";
import { LoopsPageContent } from "@/app/(portal)/loops/page";
import { DashboardPageContent } from "@/app/(portal)/page";
import { RunsPageContent } from "@/app/(portal)/runs/page";
import { SettingsPageContent } from "@/app/(portal)/settings/page";
import type { PortalRecordsResult } from "@/lib/portal/records";

afterEach(async () => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("database-backed portal pages fail closed without fixture gates", () => {
  const seededPortalResult = {
    records: {
      approval: {
        checklist: [
          { done: false, label: "Scope deploy-preview" },
          { done: false, label: "Requested by morgan-dev" },
        ],
        due: "Requested 08:56",
        owner: "morgan-dev",
        risk: "Requesting review before the preview promotes.",
        state: "requested",
      },
      artifacts: [],
      deployments: [],
      githubSettings: [
        {
          detail: "Authenticated with org-managed sign-in.",
          enabled: true,
          key: "sso",
          title: "GitHub SSO",
        },
      ],
      loops: [
        {
          enabled: true,
          name: "Intake new repo requests",
          owner: "avery-dev",
          queueDepth: 1,
          risk: "low",
          state: "Intake",
        },
      ],
      repos: [
        {
          area: "control-plane",
          ciCommands: ["bun run validate"],
          defaultBranch: "main",
          description: "Catalog projection for ncolesummers/loopworks-web.",
          enabledLoops: ["Intake and triage"],
          framework: "Next.js",
          githubHref: "https://github.com/ncolesummers/loopworks-web",
          health: "healthy",
          lastSynced: "10m ago",
          milestone: "M1",
          name: "loopworks-web",
          observabilityHref:
            "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
          openIssues: 1,
          owner: "ncolesummers",
          priority: "p1",
          staleDays: 0,
          validationGates: ["Typecheck"],
          vercelProjectHref: "https://vercel.com/ncolesummers/loopworks",
          vercelProjectId: "prj_demo_loopworks_web",
        },
      ],
      timeline: [],
      validationResults: [],
    },
    source: "db",
    usedFallback: false,
  } satisfies PortalRecordsResult;

  it("renders seeded database content in production when the database is reachable", async () => {
    const input = {
      env: { NODE_ENV: "production" } as const,
      result: seededPortalResult,
    };

    render(await DashboardPageContent(input));
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(screen.getAllByText("Live database").length).toBeGreaterThan(0);
    expect(screen.getByText("ncolesummers/loopworks-web")).toBeTruthy();
    cleanup();

    render(await CatalogPageContent(input));
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(screen.getByText("prj_demo_loopworks_web", { exact: false })).toBeTruthy();
    cleanup();

    render(await LoopsPageContent(input));
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(
      screen.getByRole("switch", { name: "Intake new repo requests" }).getAttribute("aria-checked"),
    ).toBe("true");
    cleanup();

    render(await ApprovalsPageContent(input));
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(screen.getByText("Owner morgan-dev")).toBeTruthy();
    expect(screen.getByText("Scope deploy-preview")).toBeTruthy();
    expect(screen.queryByText(/fixture/i)).toBeNull();
    cleanup();

    render(await SettingsPageContent(input));
    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(screen.getByText("Live database")).toBeTruthy();
    expect(screen.getByText("GitHub app connected")).toBeTruthy();
  });

  it.each([
    ["Dashboard", DashboardPageContent],
    ["Catalog", CatalogPageContent],
    ["Loops", LoopsPageContent],
    ["Approvals", ApprovalsPageContent],
    ["Settings", SettingsPageContent],
  ] as const)("%s page renders live-data unavailable state instead of the old fixture gate when production DB reads fail", async (_area, PageContent) => {
    const unavailableDatabase = {
      select() {
        throw new Error("database unavailable");
      },
    };

    render(
      await PageContent({
        database: unavailableDatabase as never,
        env: { NODE_ENV: "production" },
      }),
    );

    expect(screen.queryByText(/unavailable in production/i)).toBeNull();
    expect(screen.getAllByText("Portal data store unavailable.").length).toBeGreaterThan(0);
  });

  it("Runs page renders a degraded live-data notice instead of static fixtures in production", async () => {
    const unavailableDatabase = {
      select() {
        throw new Error("database unavailable");
      },
    };

    render(
      await RunsPageContent({
        database: unavailableDatabase as never,
        env: { NODE_ENV: "production" },
      }),
    );

    expect(screen.getByText("No runs available")).toBeTruthy();
    expect(screen.getByText("Run data store unavailable.")).toBeTruthy();
  });
});
