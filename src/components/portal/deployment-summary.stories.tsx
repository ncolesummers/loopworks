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

export const AllStates: Story = {
  args: {
    deployments: [
      {
        name: "production/main",
        state: "ready",
        environment: "production",
        branch: "main",
        sha: "7ad2f90",
        url: "https://loopworks.vercel.app",
        age: "1h",
        checks: ["Build ready", "Runtime logs clean"],
        inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_prod",
      },
      {
        name: "preview/ready",
        state: "ready",
        environment: "preview",
        branch: "codex/9-vercel-deploy",
        sha: "9e4a2f1",
        url: "https://loopworks-git-issue9.vercel.app",
        age: "7m",
        checks: ["Preview ready", "A11y route check passed"],
        inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_preview",
      },
      {
        name: "preview/building",
        state: "building",
        environment: "preview",
        branch: "codex/9-vercel-deploy",
        sha: "pending",
        age: "Queued",
        checks: ["Build started"],
      },
      {
        name: "preview/errored",
        state: "error",
        environment: "preview",
        branch: "codex/failed-preview",
        sha: "badc0de",
        url: "https://loopworks-git-failed.vercel.app",
        age: "3m",
        checks: ["Build failed"],
        inspectorUrl: "https://vercel.com/ncolesummers/loopworks/dpl_error",
      },
      {
        name: "preview/queued",
        state: "queued",
        environment: "preview",
        branch: "codex/23-components",
        sha: "pending",
        age: "Queued",
        checks: [],
      },
      {
        name: "Unsafe preview URL",
        state: "ready",
        environment: "preview",
        branch: "codex/23-components",
        sha: "badc0de",
        url: "javascript:alert(1)",
        age: "2m ago",
        checks: ["Build completed"],
      },
    ],
  },
};
