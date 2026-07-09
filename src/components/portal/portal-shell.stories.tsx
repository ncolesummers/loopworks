import type { Meta, StoryObj } from "@storybook/nextjs";

import { DashboardView } from "@/components/portal/dashboard-view";
import { PortalShell } from "@/components/portal/portal-shell";
import { portalFixture } from "@/lib/fixtures";
import type { PortalRecords } from "@/lib/portal/records";

const fixtureRecords = {
  approval: portalFixture.approval,
  artifacts: portalFixture.artifacts,
  deployments: portalFixture.deployments,
  githubSettings: portalFixture.githubSettings,
  loops: portalFixture.loops,
  repos: portalFixture.repos,
  timeline: portalFixture.timeline,
  validationResults: portalFixture.validationResults,
} satisfies PortalRecords;

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
    children: <DashboardView records={fixtureRecords} sourceLabel="Fixture fallback" />,
  },
};

export const GitHubSession: Story = {
  args: {
    user: {
      name: "Cole Summers",
      githubLogin: "ncolesummers",
      mode: "github",
    },
    children: <DashboardView records={fixtureRecords} sourceLabel="Fixture fallback" />,
  },
};
