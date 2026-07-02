import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { RunRecordsView } from "@/components/portal/run-records-view";
import { RunTimelineItem } from "@/components/portal/run-timeline-item";
import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import {
  createDevelopmentLoopRunSkeleton,
  projectDevelopmentLoopArtifacts,
  projectDevelopmentLoopTimeline,
} from "@/lib/loops/development-run";
import type {
  ArtifactRecord,
  DeploymentRecord,
  RepoRecord,
  RunRecord,
  ValidationResultRecord,
} from "@/lib/types";

afterEach(cleanup);

describe("portal reusable components", () => {
  it("renders explicit empty states for reusable list summaries", () => {
    render(<RepoCatalog repos={[]} />);
    expect(screen.getByText("No repositories tracked")).toBeTruthy();

    cleanup();
    render(<DeploymentSummary deployments={[]} />);
    expect(screen.getByText("No deployments available")).toBeTruthy();

    cleanup();
    render(<ValidationResultSummary results={[]} />);
    expect(screen.getByText("No validation results yet")).toBeTruthy();
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
    expect(screen.queryByText("No repositories tracked")).toBeNull();
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
