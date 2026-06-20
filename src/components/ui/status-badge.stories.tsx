import type { Meta, StoryObj } from "@storybook/nextjs";

import { StatusBadge, STATUS_META, type Status } from "@/components/ui/status-badge";

const meta = {
  title: "UI/Primitives/StatusBadge",
  component: StatusBadge,
  args: {
    status: "ready",
  },
} satisfies Meta<typeof StatusBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(STATUS_META) as Status[]).map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

export const Dots: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      {(Object.keys(STATUS_META) as Status[]).map((status) => (
        <div key={status} className="flex flex-col items-center gap-1.5">
          <StatusBadge status={status} dotOnly />
          <span className="text-xs text-muted-foreground">{STATUS_META[status].label}</span>
        </div>
      ))}
    </div>
  ),
};

const WORKFLOW_STATUSES: Status[] = [
  "loading",
  "empty",
  "disabled",
  "pending",
  "queued",
  "running",
  "blocked",
  "needsApproval",
  "approved",
  "rejected",
  "failed",
  "succeeded",
  "skipped",
  "done",
  "canceled",
];

const DEPLOYMENT_STATUSES: Status[] = [
  "building",
  "preview",
  "ready",
  "production",
  "errored",
  "canceled",
];

export const Workflow: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {WORKFLOW_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};

export const Deployment: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {DEPLOYMENT_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
