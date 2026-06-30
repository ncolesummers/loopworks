import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import type { ArtifactRecord, RepoRecord, ValidationResultRecord } from "@/lib/types";

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
