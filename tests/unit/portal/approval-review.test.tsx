import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "storybook/test";
import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { DashboardView } from "@/components/portal/dashboard-view";
import { portalFixture } from "@/lib/fixtures";
import type { ApprovalGateRecord } from "@/lib/types";

import { approvalPlanFixture } from "../../fixtures/approval-plan";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const gate = {
  ...portalFixture.approval,
  id: "27500000-0000-4000-8000-000000000002",
  runId: "27500000-0000-4000-8000-000000000001",
  scope: "plan-review",
  state: "requested",
  due: "Requested 08:56",
  checklist: [{ label: "Awaiting resolution", done: false }],
  plan: {
    id: "27500000-0000-4000-8000-000000000003",
    sha256: "a".repeat(64),
    content: JSON.stringify({
      ...approvalPlanFixture,
      untrusted: '<script>alert("plan")</script>',
    }),
    review: approvalPlanFixture,
    reviewability: "ready",
    canReject: true,
  },
} satisfies ApprovalGateRecord;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  refresh.mockReset();
});
async function submit() {
  await userEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  const confirm = screen.getByRole("button", { name: /Confirm approval/ });
  confirm.focus();
  await userEvent.keyboard("{Enter}");
}
function success(state: "approved" | "rejected" = "approved") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        approvalId: gate.id,
        transition: {
          from: "requested",
          to: state,
          actorId: "ncolesummers",
          occurredAt: "2026-09-13T09:00:00Z",
          note: "Decision context",
        },
      }),
    ),
  );
}
it("F1 shows the plan as plain text and names the card and dialog decision", () => {
  const { container } = render(<ApprovalGatePanel approval={gate} enableActions />);
  expect(screen.getByText(/<script>alert/)).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("Plan 27500000-0000-4000-8000-000000000003")).toBeTruthy();
  expect(screen.getByText(`SHA256 ${"a".repeat(64)}`)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  expect(screen.getByRole("dialog", { name: /plan-review.*27500000/ })).toBeTruthy();
});
it("F3 names every heading, link and decision control with its scope and run", () => {
  render(<ApprovalGatePanel approval={gate} enableActions />);
  expect(screen.getByRole("heading", { name: /plan-review.*27500000/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /View run.*plan-review.*27500000/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Review approval.*plan-review.*27500000/ }));
  expect(
    screen.getByRole("button", { name: /Confirm approval.*plan-review.*27500000/ }),
  ).toBeTruthy();
});
it("F3 focuses the persistent gate status and announces a keyboard decision", async () => {
  success();
  render(<ApprovalGatePanel approval={gate} enableActions />);
  await submit();
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toMatch(/Approved.*plan-review.*27500000/),
  );
  expect(document.activeElement).toBe(screen.getByRole("status"));
});
it("F9 presents coherent saved state while refresh is pending", async () => {
  success();
  render(<ApprovalGatePanel approval={gate} enableActions />);
  await submit();
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("refreshing"));
  expect(screen.queryByText("Awaiting resolution")).toBeNull();
  expect(screen.queryByText("Requested 08:56")).toBeNull();
  expect(screen.getByText(gate.risk)).toBeTruthy();
});
it.each(["approved", "rejected"] as const)(
  "removes the review control after a saved %s decision receives terminal props",
  async (state) => {
    success(state);
    const { rerender } = render(<ApprovalGatePanel approval={gate} enableActions />);
    await userEvent.click(screen.getByRole("button", { name: /Review approval/ }));
    const decision = screen.getByRole("button", {
      name: state === "approved" ? /Confirm approval/ : /Reject approval/,
    });
    decision.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("refreshing"));
    const status = screen.getByRole("status");
    expect(document.activeElement).toBe(status);
    expect(
      (screen.getByRole("button", { name: /Review approval/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();

    rerender(
      <ApprovalGatePanel
        approval={{
          ...gate,
          state,
          resolvedBy: "ncolesummers",
          due: "Resolved 09:00",
          decisionNote: "Decision context",
          checklist: [{ label: "Resolution recorded", done: true }],
        }}
        enableActions
      />,
    );
    expect(screen.queryByRole("button", { name: /Review approval/ })).toBeNull();
    expect(screen.getByRole("status")).toBe(status);
    expect(document.activeElement).toBe(status);
    expect(status.textContent).toContain(state === "approved" ? "Approved" : "Rejected");
    expect(status.textContent).toContain("Decision saved.");
    expect(status.textContent).not.toContain("refreshing");
    expect(screen.getByText("Decision note: Decision context")).toBeTruthy();
    expect(screen.getByText(gate.risk)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View run/ })).toBeTruthy();
    expect(screen.getByText(approvalPlanFixture.summary)).toBeTruthy();
  },
);
it("F9 exposes refresh failure without reporting the saved write as failed", async () => {
  success();
  refresh.mockImplementation(() => {
    throw new Error("internal refresh detail");
  });
  render(<ApprovalGatePanel approval={gate} enableActions />);
  await submit();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/Decision saved.*reload/i),
  );
  expect(screen.getByRole("alert").textContent).not.toContain("internal");
});
it("F8 gives terminal actors and legacy timestamps honest labels", () => {
  render(<ApprovalGatePanel approval={{ ...portalFixture.approval, state: "expired" }} />);
  expect(screen.getByText("Resolved by — not recorded")).toBeTruthy();
  expect(screen.getByText("Due Today, 4:00 PM")).toBeTruthy();
  expect(screen.queryByText("No run evidence attached.")).toBeNull();
});
it("F8 omits panel evidence duplicated by the dashboard", () => {
  render(
    <DashboardView
      records={{
        ...portalFixture,
        approvals: [gate],
        approval: { ...gate, artifacts: portalFixture.artifacts },
      }}
      sourceLabel="Live database"
    />,
  );
  const heading = screen.getByRole("heading", { name: /Approval gate/ });
  const card = heading.closest("#approval");
  if (!card) throw new Error("Approval card missing");
  expect(within(card as HTMLElement).queryByRole("link", { name: /View run/ })).toBeNull();
  expect(within(card as HTMLElement).queryByText("No run evidence attached.")).toBeNull();
});
it.each(["approved", "rejected", "bypassed", "expired", "cancelled", "applied"] as const)(
  "F9 offers no write for terminal %s",
  (state) => {
    render(<ApprovalGatePanel approval={{ ...gate, state }} enableActions />);
    expect(screen.queryByRole("button", { name: /Review approval/ })).toBeNull();
  },
);

it("F9 reports a saved decision whose refreshed state never arrives", async () => {
  vi.useFakeTimers();
  success();
  render(<ApprovalGatePanel approval={gate} enableActions />);
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
  });
  act(() => vi.advanceTimersByTime(10_000));
  expect(screen.getByRole("alert").textContent).toMatch(/Decision saved.*Reload/);
  expect(screen.getByRole("link", { name: "Reload approvals" })).toBeTruthy();
});

it("presents structured review sections in the active decision context", () => {
  render(
    <ApprovalGatePanel
      approval={{ ...gate, plan: { ...gate.plan, reviewability: "malformed", review: undefined } }}
      enableActions
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("heading", { name: "What approval permits" })).toBeTruthy();
  expect(dialog.getByText(/Plan content cannot be reviewed/)).toBeTruthy();
  expect(
    (dialog.getByRole("button", { name: /Confirm approval/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("never labels attached metadata as substantive verification", () => {
  render(
    <ApprovalGatePanel
      approval={{ ...gate, checklist: [{ label: "Loop context attached", done: true }] }}
    />,
  );
  expect(screen.queryByText("Verified against the current portal state.")).toBeNull();
});

it("renders the realistic structured plan and keeps its evidence inside confirmation", () => {
  render(
    <ApprovalGatePanel approval={{ ...gate, artifacts: portalFixture.artifacts }} enableActions />,
  );
  for (const name of [
    "Summary",
    "Proposed steps",
    "Planned validation",
    "Risks and mitigations",
    "What approval permits",
  ]) {
    expect(screen.getByRole("heading", { name })).toBeTruthy();
  }
  expect(screen.getByText(approvalPlanFixture.steps[0].outcome)).toBeTruthy();
  expect(screen.getByText(approvalPlanFixture.risks[0].mitigation)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByRole("heading", { name: "Proposed steps" })).toBeTruthy();
  expect(dialog.getByText(approvalPlanFixture.summary)).toBeTruthy();
  expect(dialog.getByText(approvalPlanFixture.validationGates[0].evidence)).toBeTruthy();
  expect(dialog.getByRole("link", { name: portalFixture.artifacts[0].label })).toBeTruthy();
});
it.each(["missing", "malformed", "unsupported", "unbound", "mismatch", "unpinned"] as const)(
  "blocks confirmation for %s while retaining rejection",
  (reviewability) => {
    render(
      <ApprovalGatePanel
        approval={{ ...gate, plan: { ...gate.plan, reviewability, review: undefined } }}
        enableActions
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
    expect(
      (screen.getByRole("button", { name: /Confirm approval/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Reject approval/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  },
);
it("keeps unbound rejection unavailable when the existing route lacks plan identity", () => {
  render(
    <ApprovalGatePanel
      approval={{
        ...gate,
        plan: { ...gate.plan, reviewability: "unbound", canReject: false, review: undefined },
      }}
      enableActions
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  expect(
    (screen.getByRole("button", { name: /Reject approval/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("supports technical disclosure and cancellation focus", async () => {
  render(<ApprovalGatePanel approval={gate} enableActions />);
  const trigger = screen.getByRole("button", { name: /Review approval/ });
  await userEvent.click(trigger);
  const dialog = within(screen.getByRole("dialog"));
  const technical = dialog.getByText("Technical details");
  await userEvent.click(technical);
  expect(technical.closest("details")?.open).toBe(true);
  await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("escapes plan prose and removes unsafe issue links while retaining raw evidence", () => {
  const title = '<img src=x onerror="secret()">';
  const { container } = render(
    <ApprovalGatePanel
      approval={{
        ...gate,
        plan: {
          ...gate.plan,
          review: {
            ...approvalPlanFixture,
            issue: { ...approvalPlanFixture.issue, title, url: "javascript:secret()" },
          },
        },
      }}
    />,
  );
  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.queryByRole("link", { name: title })).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(/<script>alert/)).toBeTruthy();
});

it.each(["plan-review", "deploy-preview"])(
  "keeps requester prerequisites in the active %s decision dialog",
  (scope) => {
    const risk = "Only approve if the production migration has been explicitly reviewed.";
    render(<ApprovalGatePanel approval={{ ...gate, scope, risk }} enableActions />);
    fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(risk)).toBeTruthy();
    expect(dialog.getByText(`Requested by ${gate.owner}`)).toBeTruthy();
  },
);
