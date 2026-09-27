import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { spyOn, userEvent, within } from "storybook/test";

import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import type { ApprovalGateRecord } from "@/lib/types";
import { approvalPlanFixture } from "../../../tests/fixtures/approval-plan";

// Keep browser stories independent of the full portal fixture's server-only run builders.
const approvalStoryFixture = {
  state: "needs-review",
  owner: "Priya",
  due: "Today, 4:00 PM",
  risk: "Token scopes cover GitHub read access and Vercel preview metadata only.",
  checklist: [
    { label: "Session handling is documented", done: true },
    { label: "Repo access is scoped per installation", done: true },
    { label: "Secrets are redacted from summaries", done: true },
    { label: "Write paths require explicit approval", done: false },
  ],
} satisfies ApprovalGateRecord;

const meta = {
  title: "Portal/Approvals/ApprovalGatePanel",
  component: ApprovalGatePanel,
  args: {
    approval: approvalStoryFixture,
    sourceLabel: "Fixture fallback",
  },
} satisfies Meta<typeof ApprovalGatePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Requested: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "requested",
    },
  },
};

export const Ready: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "ready",
      checklist: approvalStoryFixture.checklist.map((item) => ({ ...item, done: true })),
    },
  },
};

export const Approved: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "approved",
      checklist: approvalStoryFixture.checklist.map((item) => ({ ...item, done: true })),
    },
  },
};

export const Rejected: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "rejected",
      risk: "Reviewer rejected the requested write scope until the PR evidence is narrowed.",
    },
  },
};

export const Bypassed: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "bypassed",
      risk: "Emergency bypass was recorded with actor attribution and follow-up review.",
    },
  },
};

export const Expired: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "expired",
      due: "Expired yesterday",
      risk: "Approval expired before validation evidence was refreshed.",
    },
  },
};

export const Blocked: Story = {
  args: {
    approval: {
      ...approvalStoryFixture,
      state: "blocked",
      risk: "Repository access changed after review started; approval is blocked until scopes are rechecked.",
      checklist: approvalStoryFixture.checklist.map((item, index) => ({
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
      ...approvalStoryFixture,
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

export const PlanReview = {
  ...Actionable,
  args: {
    ...Actionable.args,
    approval: {
      ...approvalStoryFixture,
      id: "27500000-0000-4000-8000-000000000002",
      runId: "27500000-0000-4000-8000-000000000001",
      scope: "plan-review",
      state: "requested",
      plan: {
        id: "27500000-0000-4000-8000-000000000003",
        sha256: approvalPlanFixture.identity.sha256,
        content: JSON.stringify(approvalPlanFixture, null, 2),
        review: approvalPlanFixture,
        reviewability: "ready",
        canReject: true,
      },
      artifacts: [],
    },
  },
} satisfies Story;

export const PlanDecision: Story = {
  ...PlanReview,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /Review approval/ }));
  },
};
export const MissingPlan = {
  ...PlanReview,
  args: {
    ...PlanReview.args,
    approval: {
      ...PlanReview.args.approval,
      plan: {
        id: "27500000-0000-4000-8000-000000000003",
        sha256: approvalPlanFixture.identity.sha256,
        reviewability: "missing",
        canReject: true,
        reason: "The bound plan content is unavailable.",
      },
    },
  },
} satisfies Story;
export const MalformedPlan: Story = {
  ...MissingPlan,
  args: {
    ...MissingPlan.args,
    approval: {
      ...MissingPlan.args.approval,
      plan: {
        ...MissingPlan.args.approval.plan,
        reviewability: "malformed",
        content: '{"summary":"Incomplete artifact"}',
        reason: "The stored artifact does not match the planning schema.",
      },
    },
  },
};
export const PlanSaving: Story = {
  ...PlanReview,
  beforeEach: Saving.beforeEach,
  play: Saving.play,
};
export const PlanDecisionError: Story = {
  ...PlanReview,
  beforeEach: DecisionError.beforeEach,
  play: Saving.play,
};
export const ApprovedPlan: Story = {
  ...PlanReview,
  args: {
    ...PlanReview.args,
    approval: {
      ...PlanReview.args.approval,
      state: "approved",
      resolvedBy: "approval-browser-operator",
    },
  },
};
