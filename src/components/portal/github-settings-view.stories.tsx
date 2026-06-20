import type { Meta, StoryObj } from "@storybook/nextjs";

import { GitHubSettingsView } from "@/components/portal/github-settings-view";

const meta = {
  title: "Portal/Shell/GitHub Settings",
  component: GitHubSettingsView,
} satisfies Meta<typeof GitHubSettingsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
