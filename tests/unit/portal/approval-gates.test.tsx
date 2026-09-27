import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApprovalsPageContent } from "@/app/(portal)/approvals/page";
import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { portalFixture } from "@/lib/fixtures";
import type { PortalRecordsResult } from "@/lib/portal/records";
import type { ApprovalGateRecord } from "@/lib/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const gate = {
  ...portalFixture.approval,
  id: "12000000-0000-4000-8000-000000000003",
  scope: "pr-write",
  state: "requested",
  owner: "eve-builder-agent",
  resolvedBy: undefined,
} satisfies ApprovalGateRecord;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockReset();
});

it("lists every gate with distinct states, both actors and evidence", async () => {
  const result = {
    source: "db",
    usedFallback: false,
    records: {
      ...portalFixture,
      approval: gate,
      approvals: [
        gate,
        {
          ...gate,
          id: "12000000-0000-4000-8000-000000000004",
          state: "approved",
          resolvedBy: "ncolesummers",
        },
      ],
    },
  } as PortalRecordsResult;
  render(await ApprovalsPageContent({ result }));
  expect(screen.getAllByText("Write paths require explicit approval")).toHaveLength(2);
  expect(screen.getByText("Approved", { exact: true })).toBeTruthy();
  expect(screen.getByText("Resolved by ncolesummers")).toBeTruthy();
  expect(screen.getAllByText("Requested by eve-builder-agent")).toHaveLength(2);
});

it("renders the resolving actor on a completed gate", () => {
  render(
    <ApprovalGatePanel
      approval={{ ...gate, state: "approved", resolvedBy: "ncolesummers" }}
      enableActions
      sourceLabel="Live database"
    />,
  );
  expect(screen.getByText("Resolved by ncolesummers")).toBeTruthy();
});

it.each(["approve", "reject"] as const)(
  "writes %s through the existing route without client actor identity",
  async (action) => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        approvalId: gate.id,
        transition: {
          from: "requested",
          to: action === "approve" ? "approved" : "rejected",
          actorId: "ncolesummers",
          occurredAt: "2026-09-13T09:00:00Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />);
    fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
    fireEvent.change(screen.getByLabelText("Reviewer notes"), {
      target: { value: "Evidence checked." },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: action === "approve" ? /Confirm approval/ : /Reject approval/,
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/approvals/transition",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          approvalId: gate.id,
          expectedStatus: "requested",
          action,
          note: "Evidence checked.",
        }),
      }),
    );
    await waitFor(() => expect(screen.getByText("Resolved by ncolesummers")).toBeTruthy());
    expect(screen.getByText("Write paths require explicit approval")).toBeTruthy();
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: /Review approval/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  },
);

it.each([401, 403, 404, 409, 500])(
  "handles %s without disclosing response details or discarding evidence",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "secret other-user-id internal-detail" }, { status }),
        ),
    );
    render(<ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />);
    fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).not.toMatch(
      /secret|other-user-id|internal-detail/,
    );
    expect(screen.getByText("Write paths require explicit approval")).toBeTruthy();
    expect(screen.queryByText("Approved", { exact: true })).toBeNull();
  },
);

it("retains evidence and prevents duplicate submissions while a decision is pending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  render(<ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />);
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: /Reject approval/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText("Write paths require explicit approval")).toBeTruthy();
});

it("handles network failure without exposing exception text", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret host")));
  render(<ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />);
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  fireEvent.click(screen.getByRole("button", { name: /Reject approval/ }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.getByRole("alert").textContent).not.toContain("secret");
});

it("does not offer writes for fixtures or terminal states", () => {
  render(<ApprovalGatePanel approval={gate} sourceLabel="Fixture fallback" />);
  expect(screen.queryByRole("button", { name: /approval/i })).toBeNull();
});

it("the primary confirmation performs a write instead of only closing the dialog", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      approvalId: gate.id,
      transition: {
        from: "requested",
        to: "approved",
        actorId: "ncolesummers",
        occurredAt: "2026-09-13T09:00:00Z",
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />);
  fireEvent.click(screen.getByRole("button", { name: /^(Request approval|Review approval)/ }));
  fireEvent.click(screen.getByRole("button", { name: /^(Submit request|Confirm approval)/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
});

it("keeps the gate's run evidence visible after a decision", async () => {
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
        },
      }),
    ),
  );
  render(
    <ApprovalGatePanel
      approval={{
        ...gate,
        artifacts: [
          {
            label: "Review evidence",
            href: "https://github.com/ncolesummers/loopworks/pull/42",
            detail: "Validated change",
            kind: "review",
            state: "available",
          },
        ],
      }}
      enableActions
      sourceLabel="Live database"
    />,
  );
  expect(screen.getByRole("link", { name: "Review evidence" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
  await waitFor(() => expect(screen.getByText("Resolved by ncolesummers")).toBeTruthy());
  expect(screen.getByRole("link", { name: "Review evidence" })).toBeTruthy();
});

it("uses newer persisted state when a refreshed gate has changed again", async () => {
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
        },
      }),
    ),
  );
  const view = render(
    <ApprovalGatePanel approval={gate} enableActions sourceLabel="Live database" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Review approval/ }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm approval/ }));
  await waitFor(() => expect(screen.getByText("Approved", { exact: true })).toBeTruthy());
  view.rerender(
    <ApprovalGatePanel
      approval={{ ...gate, state: "cancelled", resolvedBy: "priya-sec" }}
      enableActions
      sourceLabel="Live database"
    />,
  );
  expect(screen.getByText("Cancelled", { exact: true })).toBeTruthy();
  expect(screen.getByText("Resolved by priya-sec")).toBeTruthy();
});

it("explicitly reports when no run evidence is attached", () => {
  render(<ApprovalGatePanel approval={{ ...gate, artifacts: [] }} sourceLabel="Live database" />);
  expect(screen.getByText("No run evidence attached.")).toBeTruthy();
});
