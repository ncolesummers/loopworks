import type { Meta, StoryObj } from "@storybook/nextjs";

import { DeploymentSummary } from "@/components/portal/deployment-summary";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Vercel/DeploymentSummary",
  component: DeploymentSummary,
  args: {
    deployments: portalFixture.deployments,
  },
} satisfies Meta<typeof DeploymentSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    deployments: [],
  },
};

export const PendingAndInvalidLinks: Story = {
  args: {
    deployments: [
      {
        name: "Queued preview",
        state: "queued",
        environment: "Preview",
        branch: "codex/23-components",
        sha: "pending",
        url: "pending",
        age: "Queued",
        checks: [],
      },
      {
        name: "Unsafe preview URL",
        state: "success",
        environment: "Preview",
        branch: "codex/23-components",
        sha: "badc0de",
        url: "javascript:alert(1)",
        age: "2m ago",
        checks: ["Build completed"],
      },
    ],
  },
};
