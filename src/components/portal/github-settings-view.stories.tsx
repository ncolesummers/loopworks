import type { Meta, StoryObj } from "@storybook/nextjs";

import { GitHubSettingsView } from "@/components/portal/github-settings-view";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Shell/GitHub Settings",
  component: GitHubSettingsView,
  args: {
    githubInstallations: portalFixture.githubInstallations,
    settings: portalFixture.githubSettings,
    sourceLabel: "Fixture fallback",
  },
} satisfies Meta<typeof GitHubSettingsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disconnected: Story = {
  args: {
    githubInstallations: [],
    installationOutcome: "cancelled",
  },
};
