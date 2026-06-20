import type { Meta, StoryObj } from "@storybook/nextjs";

import { DashboardView } from "@/components/portal/dashboard-view";
import { PortalShell } from "@/components/portal/portal-shell";

const meta = {
  title: "Portal/Shell",
  component: PortalShell,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PortalShell>;

export default meta;

type Story = StoryObj<typeof meta>;

export const FixtureSession: Story = {
  args: {
    user: {
      name: "ncolesummers",
      githubLogin: "ncolesummers",
      mode: "fixture",
    },
    children: <DashboardView />,
  },
};

export const GitHubSession: Story = {
  args: {
    user: {
      name: "Cole Summers",
      githubLogin: "ncolesummers",
      mode: "github",
    },
    children: <DashboardView />,
  },
};
