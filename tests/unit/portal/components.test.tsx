import { cleanup, render, screen } from "@testing-library/react";

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

    expect(screen.getByText("Next.js")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("bun run validate")).toBeTruthy();
    expect(screen.getByText("Intake and triage")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Docs" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Observability" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Design system" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Vercel project prj_loopworks" })).toBeTruthy();
  });
});
