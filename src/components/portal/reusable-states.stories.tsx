import type { Meta, StoryObj } from "@storybook/nextjs";

import { ReusableStates } from "@/components/portal/reusable-states";

const meta = {
  title: "States/ReusableStates",
  component: ReusableStates,
} satisfies Meta<typeof ReusableStates>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
