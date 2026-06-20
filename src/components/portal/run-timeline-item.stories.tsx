import type { Meta, StoryObj } from "@storybook/nextjs";

import { RunTimelineItem } from "@/components/portal/run-timeline-item";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Runs/RunTimelineItem",
  component: RunTimelineItem,
  args: {
    event: portalFixture.timeline[2],
  },
} satisfies Meta<typeof RunTimelineItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SyncEvent: Story = {
  args: {
    event: portalFixture.timeline[0],
  },
};

export const ApprovalEvent: Story = {
  args: {
    event: portalFixture.timeline[3],
  },
};
