import type { Meta, StoryObj } from "@storybook/nextjs";

import { ApprovalGatePanel } from "@/components/portal/approval-gate-panel";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Approvals/ApprovalGatePanel",
  component: ApprovalGatePanel,
  args: {
    approval: portalFixture.approval,
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
