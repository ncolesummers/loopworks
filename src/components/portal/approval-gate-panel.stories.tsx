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

export const Ready: Story = {
  args: {
    approval: {
      ...portalFixture.approval,
      state: "ready",
      checklist: portalFixture.approval.checklist.map((item) => ({ ...item, done: true })),
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
