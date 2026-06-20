import type { Meta, StoryObj } from "@storybook/nextjs";

import { RepoCatalog } from "@/components/portal/repo-catalog";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Catalog/RepoCatalog",
  component: RepoCatalog,
  args: {
    repos: portalFixture.repos,
  },
} satisfies Meta<typeof RepoCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    repos: [],
  },
};
