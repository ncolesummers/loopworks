import type { Meta, StoryObj } from "@storybook/nextjs";

import { LoopCard } from "@/components/portal/loop-card";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Loops/LoopCard",
  component: LoopCard,
  args: {
    loop: portalFixture.loops[0],
  },
} satisfies Meta<typeof LoopCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: {
    disabled: true,
    loop: {
      ...portalFixture.loops[2],
      enabled: false,
    },
  },
};
