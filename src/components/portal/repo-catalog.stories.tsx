import type { Meta, StoryObj } from "@storybook/nextjs";

import { RepoCatalog } from "@/components/portal/repo-catalog";
import { portalFixture } from "@/lib/fixtures";
import type { RepoHealth } from "@/lib/types";

const meta = {
  title: "Portal/Catalog/RepoCatalog",
  component: RepoCatalog,
  args: {
    repos: portalFixture.repos,
  },
} satisfies Meta<typeof RepoCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

function repoByHealth(health: RepoHealth) {
  const repo = portalFixture.repos.find((item) => item.health === health);

  if (!repo) {
    throw new Error(`Missing ${health} repo fixture`);
  }

  return repo;
}

export const Default: Story = {};

export const Loading: Story = {
  args: {
    repos: [],
    loading: true,
  },
};

export const Empty: Story = {
  args: {
    repos: [],
  },
};

export const Healthy: Story = {
  args: {
    repos: [repoByHealth("healthy")],
  },
};

export const Blocked: Story = {
  args: {
    repos: [repoByHealth("blocked")],
  },
};

export const Disconnected: Story = {
  args: {
    repos: [repoByHealth("disconnected")],
  },
};
