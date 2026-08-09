import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { LoopRegistry } from "@/components/portal/dashboard-view";
import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { portalEmptyState } from "@/components/portal/empty-states";
import { GitHubSettingsView } from "@/components/portal/github-settings-view";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { EmptyState } from "@/components/portal/reusable-states";
import { RunRecordsView } from "@/components/portal/run-records-view";
import { RunTimelineItem } from "@/components/portal/run-timeline-item";
import { ValidationGateSummary } from "@/components/portal/validation-gate-summary";
import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import { portalFixture } from "@/lib/fixtures";
import {
  createDevelopmentLoopRunSkeleton,
  projectDevelopmentLoopArtifacts,
  projectDevelopmentLoopTimeline,
} from "@/lib/loops/development-run";
import {
  createResearchLoopRunSkeleton,
  projectResearchLoopArtifacts,
  projectResearchLoopTimeline,
} from "@/lib/loops/research-run";
import type {
  ArtifactRecord,
  DeploymentRecord,
  RepoRecord,
  RunRecord,
  ValidationGateSummaryRecord,
  ValidationResultRecord,
} from "@/lib/types";

afterEach(cleanup);

const emptyValidationSummary: ValidationGateSummaryRecord = {
  detail: "No validation gates have completed for this run yet.",
  gates: [],
  state: "empty",
};

describe("portal reusable components", () => {
  it("keeps registered-loop fixtures owned by repositories in the fixture catalog", () => {
    const repositoryFullNames = new Set(
      portalFixture.repos.map((repository) => `${repository.owner}/${repository.name}`),
    );

    for (const loop of portalFixture.registeredLoops) {
      expect(repositoryFullNames.has(loop.repositoryFullName)).toBe(true);
    }
  });

  it("renders explicit empty states for reusable list summaries", () => {
    render(<RepoCatalog repos={[]} />);
    expect(screen.getByText("No repositories selected yet")).toBeTruthy();

    cleanup();
    render(<DeploymentSummary deployments={[]} />);
    expect(screen.getByText("No deployments available")).toBeTruthy();

    cleanup();
    render(<ValidationResultSummary results={[]} />);
    expect(screen.getByText("No validation results yet")).toBeTruthy();
  });

  it("routes the catalog's no-repositories state to the activation step it names", () => {
    render(
      <RepoCatalog firstRun={{ stage: "no-repositories", status: "onboarding" }} repos={[]} />,
    );

    expect(screen.getByText("No repositories selected yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Select repositories" }).getAttribute("href")).toBe(
      "/settings/repositories",
    );
  });

  it("routes the catalog to installation when no GitHub App is connected yet", () => {
    render(
      <RepoCatalog firstRun={{ stage: "no-installation", status: "onboarding" }} repos={[]} />,
    );

    expect(screen.getByText("No GitHub App installation connected")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Connect the GitHub App" }).getAttribute("href")).toBe(
      "/api/github/install",
    );
    // GitHub dead-ends the install link for an account that already has the App (#151), so the
    // install action alone would be the dead end this issue exists to remove.
    expect(
      screen.getByRole("link", { name: "Find existing installation" }).getAttribute("href"),
    ).toBe("/api/github/install/reconcile");
  });

  it("renders no affordance for a reset empty state with no handler to reset with", () => {
    // A "Clear filters" button that clears nothing is the same dead end as an unrouted link.
    render(<EmptyState spec={portalEmptyState("catalog-no-filter-matches")} />);

    expect(screen.getByText("No repositories match the current filters")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("gives every empty state an accessible name so its action is not orphaned", () => {
    render(<EmptyState spec={portalEmptyState("onboarding-no-loops")} />);

    const region = screen.getByRole("region", { name: "No loops registered" });
    expect(region.getAttribute("data-empty-state")).toBe("onboarding-no-loops");
  });

  it("renders an unavailable catalog read distinctly from first-run emptiness, with no call to action", () => {
    render(
      <RepoCatalog
        firstRun={{ reason: "Portal data store unavailable.", status: "unavailable" }}
        repos={[]}
      />,
    );

    // ADR 0019: a failed read cannot claim the operator has something to connect.
    expect(screen.getByText("Portal data unavailable")).toBeTruthy();
    expect(screen.getByText("Portal data store unavailable.")).toBeTruthy();
    expect(screen.queryByText("No repositories selected yet")).toBeNull();
    // The whole card, not just the empty state: no route out of a store that could not be read.
    expect(screen.queryAllByRole("link")).toEqual([]);
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("offers a filter reset when the operator's own filters emptied a populated catalog", () => {
    const repo: RepoRecord = {
      area: "Portal",
      ciCommands: ["bun run validate"],
      defaultBranch: "main",
      description: "Fixture repo",
      designSystemHref: undefined,
      docsHref: undefined,
      enabledLoops: [],
      framework: "Next.js",
      githubHref: "https://github.com/ncolesummers/loopworks",
      health: "healthy",
      lastSynced: "18m ago",
      milestone: "M4",
      name: "loopworks",
      observabilityHref: undefined,
      openIssues: 2,
      owner: "ncolesummers",
      priority: "P2",
      staleDays: 5,
      validationGates: [],
      vercelProjectHref: undefined,
      vercelProjectId: undefined,
    };

    render(<RepoCatalog repos={[repo]} />);

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "no-such-repository" },
    });

    // Operator-caused emptiness reads differently from a repository that was never tracked.
    expect(screen.getByText("No repositories match the current filters")).toBeTruthy();
    expect(screen.queryByText("No repositories selected yet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByText("ncolesummers/loopworks")).toBeTruthy();
  });

  /**
   * jsdom performs no layout, so this cannot measure pixels. What it can prove is that the three
   * states the catalog swaps between share one shell with the same minimum-height floor, rather
   * than each rolling its own box - which is the regression that reintroduces layout shift.
   * The rendered heights themselves are covered by the Playwright layer.
   */
  it("renders loading, first-run, and unavailable through one shell with the same height floor", () => {
    const shellOf = () =>
      document.querySelector("[data-empty-state], [aria-busy='true']") as HTMLElement;

    render(<RepoCatalog repos={[]} loading />);
    const loading = shellOf().className;

    cleanup();
    render(
      <RepoCatalog firstRun={{ stage: "no-repositories", status: "onboarding" }} repos={[]} />,
    );
    const empty = shellOf().className;

    cleanup();
    render(
      <RepoCatalog
        firstRun={{ reason: "Portal data store unavailable.", status: "unavailable" }}
        repos={[]}
      />,
    );
    const unavailable = shellOf().className;

    // Same shell, not merely each containing the floor somewhere in its own bespoke class list.
    expect(new Set([loading, empty, unavailable]).size).toBe(1);
    expect(loading).toContain("min-h-28");
  });

  it("declares the enabled Research routing loop registry fixture", () => {
    expect(portalFixture.loops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          name: "Research routing",
          state: "Planned",
        }),
      ]),
    );
  });

  it("does not render unsafe artifact or evidence hrefs as links", () => {
    const artifact: ArtifactRecord = {
      label: "Dangerous artifact",
      href: "javascript:alert(1)",
      detail: "Unsafe fixture link.",
      state: "available",
      kind: "log",
    };
    const result: ValidationResultRecord = {
      name: "Unsafe",
      command: "bun run unsafe",
      status: "failed",
      duration: "1s",
      detail: "Unsafe fixture evidence link.",
      artifactHref: "javascript:alert(1)",
    };

    render(<ArtifactListItem artifact={artifact} />);
    expect(screen.queryByRole("link", { name: "Dangerous artifact" })).toBeNull();
    expect(screen.getByText("Invalid Link")).toBeTruthy();

    cleanup();
    render(<ValidationResultSummary results={[result]} />);
    expect(screen.queryByRole("link", { name: "Open Unsafe evidence" })).toBeNull();
    expect(screen.getByText("Invalid Evidence Link")).toBeTruthy();
  });

  it("renders validation gate pass, fail, skipped, and raw artifact states", () => {
    const summary: ValidationGateSummaryRecord = {
      detail: "Validation report: 1 passed, 1 failed, 1 skipped.",
      generatedAt: "2026-07-08T16:00:00.000Z",
      state: "ready",
      gates: [
        {
          command: "bun run check",
          detail: "Biome check passed.",
          duration: "1.8s",
          key: "format",
          name: "Biome check",
          outcome: "pass",
          phase: "before_review",
          rawArtifactHref: "artifact://validation/format.log",
          required: true,
        },
        {
          command: "bun run test",
          detail: "A focused unit test failed.",
          duration: "1m 12s",
          key: "unit-tests",
          name: "Unit tests",
          outcome: "fail",
          phase: "before_review",
          rawArtifactHref: "javascript:alert(1)",
          required: true,
        },
        {
          command: "bun run test:e2e",
          detail: "No browser-impacting change in this fixture.",
          duration: "0s",
          key: "playwright",
          name: "Playwright",
          outcome: "skipped",
          phase: "before_rollout",
          required: false,
        },
      ],
    };

    render(<ValidationGateSummary summary={summary} />);

    expect(screen.getByRole("region", { name: "Validation gates" })).toBeTruthy();
    expect(screen.getByText("Biome check")).toBeTruthy();
    expect(screen.getByText("Unit tests")).toBeTruthy();
    expect(screen.getByText("Playwright")).toBeTruthy();
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getAllByText("Required")).toHaveLength(2);
    expect(screen.getByText("Optional")).toBeTruthy();
    expect(screen.getByText("bun run check")).toBeTruthy();
    expect(screen.getByText("Biome check passed.")).toBeTruthy();
    expect(screen.getByText("Biome check passed.").className).toContain("break-words");
    expect(
      screen.getByRole("link", { name: "Open raw artifact for Biome check" }).getAttribute("href"),
    ).toBe("artifact://validation/format.log");
    expect(screen.queryByRole("link", { name: "Open raw artifact for Unit tests" })).toBeNull();
    expect(screen.getByText("Invalid raw artifact link")).toBeTruthy();
    expect(screen.getByText("No raw artifact")).toBeTruthy();
  });

  it("renders stable validation gate empty, loading, and error states", () => {
    render(<ValidationGateSummary summary={emptyValidationSummary} />);
    expect(screen.getByText("No validation gates yet")).toBeTruthy();
    expect(screen.getByText("No validation gates have completed for this run yet.")).toBeTruthy();

    cleanup();
    render(<ValidationGateSummary loading summary={emptyValidationSummary} />);
    expect(screen.getByText("Loading validation gates")).toBeTruthy();
    expect(screen.queryByText("No validation gates yet")).toBeNull();

    cleanup();
    render(
      <ValidationGateSummary
        summary={{
          detail: "Validation report metadata could not be parsed.",
          gates: [],
          state: "error",
        }}
      />,
    );
    expect(screen.getByText("Validation summary unavailable")).toBeTruthy();
    expect(screen.getByText("Validation report metadata could not be parsed.")).toBeTruthy();
  });

  it("renders the shared agent-ready development run timeline and artifact contract", () => {
    const skeleton = createDevelopmentLoopRunSkeleton({
      mode: "simulated",
      now: new Date("2026-07-02T16:00:00.000Z"),
      trigger: {
        issueNumber: 11,
        issueUrl: "https://github.com/ncolesummers/loopworks/issues/11",
        labels: ["agent-ready", "area:loops", "priority:p0"],
        milestone: "M3 Durable Loop MVP",
        repositoryFullName: "ncolesummers/loopworks",
        title: "Agent-ready development loop skeleton",
      },
    });

    render(
      <div>
        {projectDevelopmentLoopTimeline(skeleton).map((event) => (
          <RunTimelineItem key={`${event.kind}-${event.title}`} event={event} />
        ))}
        {projectDevelopmentLoopArtifacts(skeleton).map((artifact) => (
          <ArtifactListItem key={artifact.label} artifact={artifact} />
        ))}
      </div>,
    );

    for (const stage of [
      "Planning",
      "Test writing",
      "Development",
      "Validation",
      "Code review",
      "Commit",
      "PR",
      "Done",
    ]) {
      expect(screen.getAllByText(stage, { exact: true }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("link", { name: "Validation report" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "PR intent" })).toBeTruthy();
  });

  it("renders every research stage and artifact contract through shared portal primitives", () => {
    const skeleton = createResearchLoopRunSkeleton({
      mode: "simulated",
      now: new Date("2026-07-21T16:00:00.000Z"),
      trigger: {
        issueNumber: 43,
        issueUrl: "https://github.com/ncolesummers/loopworks/issues/43",
        labels: ["agent-ready", "spike", "loop:research"],
        milestone: "M3 Durable Loop MVP",
        repositoryFullName: "ncolesummers/loopworks",
        title: "Research loop skeleton",
      },
    });

    render(
      <div>
        {projectResearchLoopTimeline(skeleton).map((event) => (
          <RunTimelineItem key={`${event.kind}-${event.title}`} event={event} />
        ))}
        {projectResearchLoopArtifacts(skeleton).map((artifact) => (
          <ArtifactListItem key={artifact.label} artifact={artifact} />
        ))}
      </div>,
    );

    for (const stage of ["Planning", "Researching", "Authoring", "Done"]) {
      expect(screen.getAllByText(stage, { exact: true }).length).toBeGreaterThan(0);
    }
    for (const artifact of [
      "Research plan",
      "Findings artifacts",
      "Research document",
      "Completion summary",
    ]) {
      expect(screen.getByRole("link", { name: artifact })).toBeTruthy();
    }
  });

  it("renders blocked and waiting-for-approval runs at a glance with detail evidence", () => {
    const runs: RunRecord[] = [
      {
        id: "run-waiting",
        repositoryFullName: "ncolesummers/factory-core",
        loopKey: "implementation-routing",
        issue: "#201",
        issueHref: "https://github.com/ncolesummers/factory-core/issues/201",
        status: "waiting_for_approval",
        priorityLabel: "Waiting approval",
        currentStage: "review",
        queuedAt: "08:55",
        age: "15m",
        approvals: [
          {
            id: "approval-requested",
            scope: "deploy-preview",
            status: "requested",
            requestedBy: "morgan-dev",
            requestedAt: "08:56",
            note: "Requesting review before the preview promotes.",
          },
        ],
        artifacts: [
          {
            label: "Approval evidence",
            href: "https://github.com/ncolesummers/factory-core/issues/201#approval",
            detail: "Requested preview evidence.",
            state: "pending",
            kind: "review",
          },
        ],
        validationSummary: emptyValidationSummary,
        steps: [
          {
            id: "step-review",
            actor: "reviewer",
            at: "08:56",
            detail: "Waiting for maintainer approval.",
            kind: "approval",
            status: "running",
            title: "Approval gate",
          },
        ],
      },
      {
        id: "run-blocked",
        repositoryFullName: "ncolesummers/delivery-ops",
        loopKey: "review-gate",
        issue: "#303",
        issueHref: "https://github.com/ncolesummers/delivery-ops/issues/303",
        status: "blocked",
        priorityLabel: "Blocked",
        currentStage: "validation",
        queuedAt: "08:50",
        age: "20m",
        blockedReason: "Blocked on missing Vercel scope grant.",
        approvals: [],
        artifacts: [],
        validationSummary: emptyValidationSummary,
        steps: [],
      },
    ];

    render(<RunRecordsView runs={runs} sourceLabel="Fixture fallback" />);

    expect(screen.getByRole("heading", { name: "Run timeline and artifacts" })).toBeTruthy();
    expect(screen.getAllByText("Waiting approval").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
    expect(screen.getByText("Blocked on missing Vercel scope grant.")).toBeTruthy();
    expect(screen.getByText("ncolesummers/factory-core")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /ncolesummers\/factory-core/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByText("deploy-preview")).toBeTruthy();
    expect(screen.getByText("Requested at 08:56")).toBeTruthy();
    expect(screen.getByText(/morgan-dev/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Approval evidence" })).toBeTruthy();

    cleanup();
    render(
      <RunRecordsView initialRunId="run-blocked" runs={runs} sourceLabel="Fixture fallback" />,
    );
    expect(
      screen
        .getByRole("button", { name: /ncolesummers\/delivery-ops/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getAllByText("Blocked on missing Vercel scope grant.").length).toBeGreaterThan(0);
  });

  it("renders normalized Vercel deployment state, environment, metadata, and safe links", () => {
    const deployments: DeploymentRecord[] = [
      {
        name: "production/main",
        state: "ready",
        environment: "production",
        branch: "main",
        sha: "7ad2f90",
        url: "https://loopworks.vercel.app",
        age: "1h",
        checks: ["Build ready", "Runtime logs clean"],
        inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_prod",
      },
      {
        name: "preview/building",
        state: "building",
        environment: "preview",
        branch: "codex/9-vercel-deploy",
        sha: "pending",
        age: "Queued",
        checks: ["Build started"],
      },
      {
        name: "preview/errored",
        state: "error",
        environment: "preview",
        branch: "codex/failed-preview",
        sha: "badc0de",
        url: "https://loopworks-git-failed.vercel.app",
        age: "3m",
        checks: ["Build failed"],
        inspectorUrl: "javascript:alert(1)",
      },
      {
        name: "preview/unsafe-url",
        state: "ready",
        environment: "preview",
        branch: "codex/unsafe-url",
        sha: "c0ffee",
        url: "javascript:alert(1)",
        age: "2m",
        checks: ["Preview ready"],
      },
    ];

    render(<DeploymentSummary deployments={deployments} />);

    expect(screen.getByText("Production")).toBeTruthy();
    expect(screen.getAllByText("Preview").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("Building")).toBeTruthy();
    expect(screen.getByText("Errored")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("7ad2f90")).toBeTruthy();
    expect(screen.getByText("codex/9-vercel-deploy")).toBeTruthy();
    expect(screen.getByText("badc0de")).toBeTruthy();
    expect(screen.getByText("Runtime logs clean")).toBeTruthy();

    expect(screen.getByRole("link", { name: "Open production/main" }).getAttribute("href")).toBe(
      "https://loopworks.vercel.app/",
    );
    expect(
      screen
        .getByRole("link", { name: "Open Vercel details for production/main" })
        .getAttribute("href"),
    ).toBe("https://vercel.com/ncolesummers/loopworks/dpl_prod");
    expect(
      screen.queryByRole("link", { name: "Open Vercel details for preview/errored" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open preview/building" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.queryByRole("link", { name: "Open preview/unsafe-url" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open preview/unsafe-url" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("No preview URL yet")).toBeTruthy();
    expect(screen.getByText("Invalid deployment URL")).toBeTruthy();
    expect(screen.getByText("Build failed").closest("span")?.className).toContain("danger");
    expect(screen.getByText("Build started").closest("span")?.className).toContain("info");
  });

  it("renders persona-critical catalog metadata for maintainers", () => {
    const repo: RepoRecord = {
      name: "loopworks-web",
      owner: "ncolesummers",
      description: "Operator portal for repo intake, approvals, and deploy visibility.",
      health: "healthy",
      githubHref: "https://github.com/ncolesummers/loopworks-web",
      milestone: "M1",
      area: "design-system",
      priority: "p0",
      openIssues: 14,
      staleDays: 1,
      lastSynced: "2m ago",
      framework: "Next.js",
      defaultBranch: "main",
      ciCommands: ["bun run validate", "bun run build"],
      docsHref: "https://github.com/ncolesummers/loopworks/tree/main/docs",
      observabilityHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/observability.md",
      designSystemHref:
        "https://github.com/ncolesummers/loopworks/blob/main/docs/design-review-checklist.md",
      enabledLoops: ["Intake and triage", "Implementation routing"],
      validationGates: ["Typecheck", "Playwright", "Storybook"],
      vercelProjectId: "prj_loopworks",
      vercelProjectHref: "https://vercel.com/ncolesummers/loopworks",
    };

    render(<RepoCatalog repos={[repo]} />);

    expect(
      screen.getByRole("link", { name: "ncolesummers/loopworks-web" }).getAttribute("href"),
    ).toBe("https://github.com/ncolesummers/loopworks-web");
    expect(screen.getByText("Next.js")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("bun run validate")).toBeTruthy();
    expect(screen.getByText("Intake and triage")).toBeTruthy();
    expect(screen.getByText("Typecheck")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Observability" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Design system" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vercel project prj_loopworks" })).toBeTruthy();
  });

  it("does not render unsafe catalog repo hrefs as links", () => {
    const repo: RepoRecord = {
      name: "unsafe-repo",
      owner: "ncolesummers",
      description: "Repository with an unsafe fixture URL.",
      health: "blocked",
      githubHref: "javascript:alert(1)",
      milestone: "M2",
      area: "catalog",
      priority: "p0",
      openIssues: 2,
      staleDays: 5,
      lastSynced: "18m ago",
      framework: "Fixture",
      defaultBranch: "main",
      ciCommands: ["bun run validate"],
      enabledLoops: ["Intake and triage"],
      validationGates: ["Playwright"],
    };

    render(<RepoCatalog repos={[repo]} />);

    expect(screen.getByText("ncolesummers/unsafe-repo")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "ncolesummers/unsafe-repo" })).toBeNull();
  });

  it("renders catalog loading state without falling through to empty", () => {
    render(<RepoCatalog repos={[]} loading />);

    expect(screen.getByText("Loading repositories")).toBeTruthy();
    expect(screen.queryByText("No repositories selected yet")).toBeNull();
  });

  it("renders source labels and explicit empty states for database-backed portal panels", () => {
    render(<LoopRegistry loops={[]} sourceLabel="Live database" />);
    expect(screen.getByText("Live database")).toBeTruthy();
    expect(screen.getByText("No loops tracked")).toBeTruthy();
    expect(
      screen.getByText(
        "Loop rows are mirrored from GitHub issue sync and appear once sync writes durable state.",
      ),
    ).toBeTruthy();

    cleanup();
    render(<ApprovalGatePanel approval={null} sourceLabel="Live database" />);
    expect(screen.getByText("No approval gates available")).toBeTruthy();
    expect(
      screen.getByText("Approval gates appear after a loop or run requests review."),
    ).toBeTruthy();

    cleanup();
    render(
      <GitHubSettingsView
        emptyDetail="No settings can be projected until repository and loop rows exist."
        readOnly
        settings={[]}
        sourceLabel="Live database"
      />,
    );
    expect(screen.getByText("Live database")).toBeTruthy();
    expect(screen.getByText("No GitHub settings projected")).toBeTruthy();
    expect(
      screen.getByText("No settings can be projected until repository and loop rows exist."),
    ).toBeTruthy();
    expect(screen.queryByText("Fixture control surface")).toBeNull();
    expect(screen.queryByText("Refresh fixture snapshot")).toBeNull();
  });

  it("keeps database-backed approval and settings copy neutral and read-only", async () => {
    render(
      <ApprovalGatePanel
        approval={{
          checklist: [
            { done: true, label: "Scope deploy-preview" },
            { done: false, label: "Awaiting resolution" },
          ],
          due: "Requested 08:56",
          owner: "morgan-dev",
          risk: "Requesting review before the preview promotes.",
          state: "requested",
        }}
        sourceLabel="Live database"
      />,
    );

    expect(screen.getByText("Verified against the current portal state.")).toBeTruthy();
    expect(screen.queryByText(/fixture/i)).toBeNull();

    cleanup();
    render(
      <GitHubSettingsView
        readOnly
        settings={[
          {
            detail: "1 repository has GitHub installation metadata.",
            enabled: true,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );
    const scopingTab = screen.getByRole("tab", { name: "Scoping" });
    fireEvent.pointerDown(scopingTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(scopingTab, { button: 0, ctrlKey: false });
    fireEvent.click(scopingTab);
    await waitFor(() => expect(scopingTab.getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("switch", { name: "GitHub SSO" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Fixture control surface")).toBeNull();
  });

  it("renders a truthful keyboard-operable GitHub App installation state", () => {
    const { rerender } = render(
      <GitHubSettingsView
        githubInstallations={[]}
        installationOutcome="connected"
        readOnly
        settings={[
          {
            detail: "No GitHub App installation is connected yet.",
            enabled: false,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );

    expect(screen.getByRole("link", { name: "Connect GitHub App" }).getAttribute("href")).toBe(
      "/api/github/install",
    );
    expect(
      screen.queryByDisplayValue("projected from repository installation metadata"),
    ).toBeNull();
    expect(screen.queryByDisplayValue("ncolesummers")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("could not be verified");

    rerender(
      <GitHubSettingsView
        githubInstallations={[
          {
            accountLogin: "loopworks-org",
            accountType: "Organization",
            installationId: 124_001,
            repositorySelection: "selected",
          },
        ]}
        installationOutcome="already-connected"
        readOnly
        settings={[
          {
            detail: "1 GitHub App installation is connected.",
            enabled: true,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );

    expect(screen.getByText("loopworks-org")).toBeTruthy();
    expect(screen.queryByDisplayValue("ncolesummers")).toBeNull();
    expect(screen.getByText("124001")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("already connected");
    expect(screen.queryByRole("link", { name: "Connect GitHub App" })).toBeNull();
  });

  /**
   * GitHub dead-ends the install link when the only eligible account already has
   * the App (#151), so "Not connected" must always sit next to an affordance that
   * can actually resolve it.
   */
  it("offers the reconciliation route alongside the install route when disconnected", () => {
    render(
      <GitHubSettingsView
        githubInstallations={[]}
        readOnly
        settings={[
          {
            detail: "No GitHub App installation is connected yet.",
            enabled: false,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );

    const install = screen.getByRole("link", { name: "Connect GitHub App" });
    const reconcile = screen.getByRole("link", { name: "Find existing installation" });
    expect(install.getAttribute("href")).toBe("/api/github/install");
    expect(reconcile.getAttribute("href")).toBe("/api/github/install/reconcile");
    // The primary action must stay first in DOM and therefore tab order.
    expect(install.compareDocumentPosition(reconcile)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText(/already installed the loopworks github app/i)).toBeTruthy();
  });

  it("names the cause when reconciliation finds no installation for the operator", () => {
    render(
      <GitHubSettingsView
        githubInstallations={[]}
        installationOutcome="no-installation-found"
        readOnly
        settings={[
          {
            detail: "No GitHub App installation is connected yet.",
            enabled: false,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );

    // Not a success claim, so the display-only downgrade must leave it intact.
    expect(screen.getByRole("status").textContent).toContain(
      "No GitHub App installation was visible to your GitHub account",
    );
    // The copy must not send the operator back to the install link that already
    // dead-ended; it names the access case too.
    expect(screen.getByRole("status").textContent).toContain("cannot access the installation");
    expect(screen.getByRole("status").textContent).not.toContain("could not be verified");
    expect(screen.getByRole("link", { name: "Find existing installation" })).toBeTruthy();
  });

  /**
   * The result parameter is display-only in both directions: it cannot claim a
   * connection the rows do not show, and it cannot claim the absence of one they
   * do — a stale reconciliation link would otherwise render a page saying both.
   */
  it("suppresses a no-installation result that contradicts the connected rows", () => {
    render(
      <GitHubSettingsView
        githubInstallations={[
          {
            accountLogin: "loopworks-org",
            accountType: "Organization",
            installationId: 124_001,
            repositorySelection: "selected",
          },
        ]}
        installationOutcome="no-installation-found"
        readOnly
        settings={[
          {
            detail: "1 GitHub App installation is connected.",
            enabled: true,
            key: "sso",
            title: "GitHub SSO",
          },
        ]}
        sourceLabel="Live database"
      />,
    );

    expect(screen.getByText("GitHub app connected")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  /**
   * ADR 0019: a failed read must not render a connection call to action, so the
   * badge cannot claim "Not connected" either — that would be an unresolvable
   * dead end of a different kind.
   */
  it("reports an unavailable read as unknown rather than not connected", () => {
    render(
      <GitHubSettingsView
        dataUnavailable
        emptyDetail="Portal data store unavailable."
        githubInstallations={[]}
        readOnly
        settings={[]}
        sourceLabel="Unavailable"
      />,
    );

    expect(screen.getByText("Connection unknown")).toBeTruthy();
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.queryByRole("link", { name: "Connect GitHub App" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Find existing installation" })).toBeNull();
  });

  it("filters catalog rows by search and health while preserving explicit filtered-empty state", () => {
    const repos: RepoRecord[] = [
      {
        name: "loopworks-web",
        owner: "ncolesummers",
        description: "Operator portal for repo intake, approvals, and deploy visibility.",
        health: "healthy",
        githubHref: "https://github.com/ncolesummers/loopworks-web",
        milestone: "M1",
        area: "design-system",
        priority: "p0",
        openIssues: 14,
        staleDays: 1,
        lastSynced: "2m ago",
        framework: "Next.js",
        defaultBranch: "main",
        ciCommands: ["bun run validate"],
        enabledLoops: ["Intake and triage"],
        validationGates: ["Typecheck"],
      },
      {
        name: "delivery-ops",
        owner: "ncolesummers",
        description: "Blocked deployment workflow catalog fixture.",
        health: "blocked",
        githubHref: "https://github.com/ncolesummers/delivery-ops",
        milestone: "M2",
        area: "catalog",
        priority: "p0",
        openIssues: 3,
        staleDays: 6,
        lastSynced: "14m ago",
        framework: "Next.js",
        defaultBranch: "main",
        ciCommands: ["bun run validate"],
        enabledLoops: ["Review gate"],
        validationGates: ["Playwright"],
      },
      {
        name: "integration-playground",
        owner: "ncolesummers",
        description: "Disconnected GitHub and Vercel sync fixture.",
        health: "disconnected",
        githubHref: "https://github.com/ncolesummers/integration-playground",
        milestone: "M2",
        area: "github",
        priority: "p1",
        openIssues: 6,
        staleDays: 9,
        lastSynced: "17m ago",
        framework: "Fixture",
        defaultBranch: "main",
        ciCommands: ["bun run test:e2e"],
        enabledLoops: [],
        validationGates: ["Fixture fallback check"],
      },
    ];

    render(<RepoCatalog repos={repos} />);

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "delivery" },
    });
    expect(screen.getByText("ncolesummers/delivery-ops")).toBeTruthy();
    expect(screen.queryByText("ncolesummers/loopworks-web")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Filter by health"), {
      target: { value: "disconnected" },
    });
    expect(screen.getByText("ncolesummers/integration-playground")).toBeTruthy();
    expect(screen.queryByText("ncolesummers/delivery-ops")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search repositories"), {
      target: { value: "missing-repo" },
    });
    expect(screen.getByText("No repositories match the current filters")).toBeTruthy();
  });
});
