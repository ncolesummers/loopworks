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
    event: {
      kind: "sync",
      at: "09:12",
      actor: "GitHub webhook",
      title: "Issue sync completed",
      detail: "Fetched labels, milestones, and issue state for loop hydration.",
    },
  },
};

export const ApprovalEvent: Story = {
  args: {
    event: {
      kind: "approval",
      at: "10:02",
      actor: "Maintainer",
      title: "Approval requested",
      detail: "Security review gate is waiting on redaction confirmation.",
    },
  },
};

export const FullStageMatrix: Story = {
  render: () => (
    <div className="space-y-3">
      {portalFixture.timeline.map((event) => (
        <RunTimelineItem key={`${event.kind}-${event.at}`} event={event} />
      ))}
    </div>
  ),
};
