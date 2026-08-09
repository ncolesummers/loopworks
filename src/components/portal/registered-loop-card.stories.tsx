import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { RegisteredLoopCard } from "@/components/portal/registered-loop-card";
import { portalFixture } from "@/lib/fixtures";
import type { RegisteredLoopItem } from "@/lib/types";

const [developmentLoop, researchLoop] = portalFixture.registeredLoops as [
  RegisteredLoopItem,
  RegisteredLoopItem,
];

const meta = {
  title: "Portal/Loops/RegisteredLoopCard",
  component: RegisteredLoopCard,
  args: { loop: developmentLoop },
  parameters: { layout: "padded" },
} satisfies Meta<typeof RegisteredLoopCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Paused: Story = { args: { loop: researchLoop } };

export const NoApprovalRequirements: Story = {
  args: { loop: { ...developmentLoop, approvalRequirements: [] } },
};

export const ManyTriggerLabels: Story = {
  args: {
    loop: {
      ...developmentLoop,
      triggerLabels: [
        "agent-ready",
        "status:ready",
        "area:loops",
        "priority:p0",
        "needs-triage",
        "good-first-issue",
      ],
    },
  },
};

export const LongNames: Story = {
  args: {
    loop: {
      ...developmentLoop,
      name: "Agent-ready development loop for the operator control plane and its validation gates",
      repositoryFullName: "loopworks-organization/operator-control-plane-portal",
      validationGates: [
        {
          key: "aggregate-validation",
          name: "Aggregate validation across typecheck, unit, Storybook, and Playwright",
          required: true,
        },
      ],
    },
  },
};
