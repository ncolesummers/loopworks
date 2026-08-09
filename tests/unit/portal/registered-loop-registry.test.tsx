import { cleanup, render, screen, within } from "@testing-library/react";

import { RegisteredLoopRegistry } from "@/components/portal/registered-loop-registry";
import type { RegisteredLoopItem } from "@/lib/types";

afterEach(cleanup);

function loop(overrides: Partial<RegisteredLoopItem> = {}): RegisteredLoopItem {
  return {
    approvalRequirements: ["external_write", "pr_creation"],
    enabled: true,
    key: "development-loop",
    name: "Agent-ready development loop",
    repositoryFullName: "ncolesummers/loopworks",
    triggerLabels: ["agent-ready", "status:ready"],
    validationGates: [
      { key: "focused-tests", name: "Focused manifest tests", required: true },
      { key: "aggregate-validation", name: "Aggregate validation", required: false },
    ],
    ...overrides,
  };
}

function registry() {
  return screen.getByRole("region", { name: "Registered loops" });
}

describe("registered loop registry", () => {
  it("shows enabled state, trigger labels, validation gates, and approval requirements", () => {
    render(<RegisteredLoopRegistry loops={[loop()]} sourceLabel="Live database" />);

    const entry = within(registry()).getByRole("article", {
      name: "Agent-ready development loop",
    });

    expect(within(entry).getByText("Enabled")).toBeTruthy();
    expect(within(entry).getByText("ncolesummers/loopworks")).toBeTruthy();
    expect(within(entry).getByText("development-loop")).toBeTruthy();

    const triggers = within(entry).getByRole("list", { name: "Trigger labels" });
    expect(
      within(triggers)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["agent-ready", "status:ready"]);

    const gates = within(entry).getByRole("list", { name: "Validation gates" });
    const gateText = within(gates)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(gateText).toHaveLength(2);
    expect(gateText[0]).toContain("Focused manifest tests");
    // Required and optional gates must be distinguishable, not just listed.
    expect(gateText[0]).toContain("Required");
    expect(gateText[1]).toContain("Optional");

    const approvals = within(entry).getByRole("list", { name: "Approval requirements" });
    expect(
      within(approvals)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["external_write", "pr_creation"]);
  });

  it("shows a paused loop as paused rather than omitting its state", () => {
    render(
      <RegisteredLoopRegistry loops={[loop({ enabled: false })]} sourceLabel="Live database" />,
    );

    expect(within(registry()).getByText("Paused")).toBeTruthy();
    expect(within(registry()).queryByText("Enabled")).toBeNull();
  });

  it("counts only enabled loops in the header", () => {
    render(
      <RegisteredLoopRegistry
        loops={[loop(), loop({ enabled: false, key: "research-loop", name: "Research loop" })]}
        sourceLabel="Live database"
      />,
    );

    expect(within(registry()).getByText("Live database")).toBeTruthy();
    expect(within(registry()).getByText("1 enabled")).toBeTruthy();
  });

  it("renders an explicit empty state that routes to registration", () => {
    render(
      <RegisteredLoopRegistry
        firstRun={{ stage: "no-loops", status: "onboarding" }}
        loops={[]}
        sourceLabel="Live database"
      />,
    );

    expect(within(registry()).getByText("No loops registered")).toBeTruthy();
    const action = within(registry()).getByRole("link", { name: "Register a loop" });
    expect(action.getAttribute("href")).toBe("/loops/register");
  });

  it("names the earlier activation step when a loop cannot be registered yet", () => {
    render(
      <RegisteredLoopRegistry
        firstRun={{ stage: "no-repositories", status: "onboarding" }}
        loops={[]}
        sourceLabel="Live database"
      />,
    );

    // Registration is scoped to a repository, so offering it before one exists would dead-end.
    expect(within(registry()).queryByRole("link", { name: "Register a loop" })).toBeNull();
    expect(
      within(registry()).getByRole("link", { name: "Select repositories" }).getAttribute("href"),
    ).toBe("/settings/repositories");
  });

  it("explains an unavailable store instead of inviting registration into it", () => {
    render(
      <RegisteredLoopRegistry
        firstRun={{ reason: "Portal data store unavailable.", status: "unavailable" }}
        loops={[]}
        sourceLabel="Unavailable"
      />,
    );

    expect(within(registry()).getByText("Portal data store unavailable.")).toBeTruthy();
    // A first-run empty state must never be confused with a failed read (ADR 0019).
    expect(within(registry()).queryByRole("link", { name: "Register a loop" })).toBeNull();
    expect(within(registry()).queryByRole("link")).toBeNull();
  });

  it("keeps a registration route available while loops already exist", () => {
    render(<RegisteredLoopRegistry loops={[loop()]} sourceLabel="Live database" />);

    expect(
      within(registry()).getByRole("link", { name: "Register a loop" }).getAttribute("href"),
    ).toBe("/loops/register");
  });

  it("renders an explicit placeholder when a loop declares no approval requirements", () => {
    render(
      <RegisteredLoopRegistry
        loops={[loop({ approvalRequirements: [] })]}
        sourceLabel="Live database"
      />,
    );

    const entry = within(registry()).getByRole("article", {
      name: "Agent-ready development loop",
    });
    expect(within(entry).getByText("None")).toBeTruthy();
  });
});
