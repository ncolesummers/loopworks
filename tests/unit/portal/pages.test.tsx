import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";

import { ApprovalsPageContent } from "@/app/(portal)/approvals/page";
import { CatalogPageContent } from "@/app/(portal)/catalog/page";
import { LoopsPageContent } from "@/app/(portal)/loops/page";
import { DashboardPageContent } from "@/app/(portal)/page";
import { RunsPageContent } from "@/app/(portal)/runs/page";
import SettingsPage, { SettingsPageContent } from "@/app/(portal)/settings/page";
import { githubInstallationOutcomes } from "@/components/portal/github-installation-outcome";
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
      githubInstallations: [
        {
          accountLogin: "ncolesummers",
          accountType: "User",
          installationId: 800_000_001,
          repositorySelection: "selected",
        },
      ],
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
      registeredLoops: [
        {
          approvalRequirements: ["external_write", "pr_creation"],
          enabled: true,
          key: "development-loop",
          name: "Agent-ready development loop",
          repositoryFullName: "ncolesummers/loopworks",
          triggerLabels: ["agent-ready"],
          validationGates: [
            { key: "aggregate-validation", name: "Aggregate validation", required: true },
          ],
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
    // Registered contracts lead; the issue mirror stays, labelled for what it is.
    expect(screen.getByRole("region", { name: "Registered loops" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Registered loops" })).getByRole("article", {
        name: "Agent-ready development loop",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Synced issue loops")).toBeTruthy();
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

  /**
   * The Settings allowlist is what turns a callback outcome into visible copy. An
   * outcome the allowlist drops (#151 added one) would silently render nothing —
   * the dead end this work exists to remove. Iterating the exported vocabulary
   * rather than a hand-written copy is what makes that unmissable.
   */
  /**
   * The vocabulary must live outside a `"use client"` module. A runtime value
   * exported from a client module reaches this server component as a
   * client-reference proxy, so `new Set(...)` throws at module evaluation and
   * every `/settings` request 500s — a failure no type-check and no direct
   * component render can see.
   */
  it("keeps the result vocabulary in a module the server page can actually read", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/portal/github-installation-outcome.ts"),
      "utf8",
    );

    // The directive itself, not a mention of it in prose.
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(Array.isArray(githubInstallationOutcomes)).toBe(true);
  });

  it("Settings page admits every declared result and drops anything else", async () => {
    expect(githubInstallationOutcomes).toContain("no-installation-found");

    for (const outcome of githubInstallationOutcomes) {
      const admitted = await SettingsPage({ searchParams: Promise.resolve({ github: outcome }) });
      expect(admitted.props.installationOutcome).toBe(outcome);

      const spoofed = await SettingsPage({
        searchParams: Promise.resolve({ github: `${outcome}-ish` }),
      });
      expect(spoofed.props.installationOutcome).toBeUndefined();
    }
  });

  it.each([
    ["Dashboard", DashboardPageContent],
    ["Catalog", CatalogPageContent],
    ["Loops", LoopsPageContent],
    ["Approvals", ApprovalsPageContent],
    ["Settings", SettingsPageContent],
  ] as const)(
    "%s page renders live-data unavailable state instead of the old fixture gate when production DB reads fail",
    async (_area, PageContent) => {
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
    },
  );

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

    // A failed read reports as unavailable, not as a verified absence of runs (ADR 0019, #127).
    expect(screen.getByText("Portal data unavailable")).toBeTruthy();
    expect(screen.getByText("Run data store unavailable.")).toBeTruthy();
    expect(screen.queryByText("No runs available")).toBeNull();
  });
});
