import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { spyOn, userEvent, within } from "storybook/test";

import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Approvals/ApprovalGatePanel",
  component: ApprovalGatePanel,
  args: {
    approval: portalFixture.approval,
    sourceLabel: "Fixture fallback",
  },
} satisfies Meta<typeof ApprovalGatePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Requested: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "requested",
    },
  },
};

export const Ready: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "ready",
      checklist: portalFixture.approval.checklist.map((item) => ({ ...item, done: true })),
    },
  },
};

export const Approved: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "approved",
      checklist: portalFixture.approval.checklist.map((item) => ({ ...item, done: true })),
    },
  },
};

export const Rejected: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "rejected",
      risk: "Reviewer rejected the requested write scope until the PR evidence is narrowed.",
    },
  },
};

export const Bypassed: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "bypassed",
      risk: "Emergency bypass was recorded with actor attribution and follow-up review.",
    },
  },
};

export const Expired: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "expired",
      due: "Expired yesterday",
      risk: "Approval expired before validation evidence was refreshed.",
    },
  },
};

export const Blocked: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "blocked",
      risk: "Repository access changed after review started; approval is blocked until scopes are rechecked.",
      checklist: portalFixture.approval.checklist.map((item, index) => ({
        ...item,
        done: index < 2,
      })),
    },
  },
};

export const Empty: Story = { args: { approval: null } };

export const Unavailable: Story = {
  args: {
    approval: null,
    sourceLabel: "Unavailable",
    firstRun: { status: "unavailable", reason: "database-read-failed" },
  },
};

export const Actionable: Story = {
  parameters: { nextjs: { appDirectory: true } },
  args: {
    enableActions: true,
    sourceLabel: "Live database",
    approval: {
      ...portalFixture.approval,
      id: "12000000-0000-4000-8000-000000000003",
      state: "requested",
    },
  },
};

export const Saving: Story = {
  ...Actionable,
  beforeEach: () => {
    const originalFetch = globalThis.fetch;
    const mock = spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      input === "/api/approvals/transition" ? new Promise(() => {}) : originalFetch(input, init),
    );
    return () => mock.mockRestore();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Review approval/ }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("button", { name: /Confirm approval/ }),
    );
  },
};

export const DecisionError: Story = {
  ...Actionable,
  beforeEach: () => {
    const originalFetch = globalThis.fetch;
    const mock = spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      input === "/api/approvals/transition"
        ? Promise.resolve(Response.json({}, { status: 409 }))
        : originalFetch(input, init),
    );
    return () => mock.mockRestore();
  },
  play: Saving.play,
};

export const PlanReview: Story = {
  ...Actionable,
  args: {
    ...Actionable.args,
    approval: {
      ...portalFixture.approval,
      id: "27500000-0000-4000-8000-000000000002",
      runId: "27500000-0000-4000-8000-000000000001",
      scope: "plan-review",
      state: "requested",
      plan: {
        id: "27500000-0000-4000-8000-000000000003",
        sha256: "a".repeat(64),
        content: '{"summary":"Review approval evidence before test writing."}',
      },
      artifacts: [],
    },
  },
};
