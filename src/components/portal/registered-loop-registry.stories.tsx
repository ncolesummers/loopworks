import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { RegisteredLoopRegistry } from "@/components/portal/registered-loop-registry";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Loops/RegisteredLoopRegistry",
  component: RegisteredLoopRegistry,
  args: { loops: portalFixture.registeredLoops, sourceLabel: "Fixture fallback" },
  parameters: { layout: "padded" },
} satisfies Meta<typeof RegisteredLoopRegistry>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SingleLoop: Story = {
  args: { loops: portalFixture.registeredLoops.slice(0, 1), sourceLabel: "Live database" },
};

export const Empty: Story = { args: { loops: [], sourceLabel: "Live database" } };

export const ErrorPanel: Story = {
  args: {
    emptyDetail: "Portal data store unavailable.",
    loops: [],
    sourceLabel: "Unavailable",
  },
};
