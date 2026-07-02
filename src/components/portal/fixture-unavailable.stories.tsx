import type { Meta, StoryObj } from "@storybook/nextjs";

import { FixtureUnavailableNotice } from "@/components/portal/fixture-unavailable";

const meta = {
  title: "Portal/States/FixtureUnavailableNotice",
  component: FixtureUnavailableNotice,
  args: {
    area: "Catalog",
  },
} satisfies Meta<typeof FixtureUnavailableNotice>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Approvals: Story = {
  args: {
    area: "Approvals",
  },
};
