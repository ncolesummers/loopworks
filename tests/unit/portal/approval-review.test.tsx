import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "storybook/test";
import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { DashboardView } from "@/components/portal/dashboard-view";
import { portalFixture } from "@/lib/fixtures";
import type { ApprovalGateRecord } from "@/lib/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const gate: ApprovalGateRecord = {
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
    content: '<script>alert("plan")</script>',
  },
};
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
function success() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        approvalId: gate.id,
        transition: {
          from: "requested",
          to: "approved",
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
  expect(screen.getByText('<script>alert("plan")</script>')).toBeTruthy();
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
