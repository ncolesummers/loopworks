import { cleanup, render, screen } from "@testing-library/react";

import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import type { ArtifactRecord, ValidationResultRecord } from "@/lib/types";

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
});
