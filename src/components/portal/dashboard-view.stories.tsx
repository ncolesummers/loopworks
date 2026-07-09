import type { Meta, StoryObj } from "@storybook/nextjs";

import { DashboardView } from "@/components/portal/dashboard-view";
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
  title: "Portal/Shell/Dashboard",
  component: DashboardView,
  args: {
    records: fixtureRecords,
    sourceLabel: "Fixture fallback",
  },
} satisfies Meta<typeof DashboardView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
