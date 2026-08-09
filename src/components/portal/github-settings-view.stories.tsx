import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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

/**
 * The operator reconciled, but GitHub reported no installation of this App on
 * any account they can reach (#151). The notice must name the cause rather than
 * leaving the surface silently unchanged.
 */
export const NoInstallationFound: Story = {
  args: {
    githubInstallations: [],
    installationOutcome: "no-installation-found",
  },
};

/** A failed portal read cannot claim a connection state in either direction. */
export const DataUnavailable: Story = {
  args: {
    dataUnavailable: true,
    emptyDetail: "Portal data store unavailable.",
    githubInstallations: [],
    settings: [],
    sourceLabel: "Unavailable",
  },
};
