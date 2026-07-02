import type { Meta, StoryObj } from "@storybook/nextjs";

import { RunRecordsView } from "@/components/portal/run-records-view";
import { buildRunFixtureRecords } from "@/lib/runs/fixtures";

const fixtureRuns = buildRunFixtureRecords();

const meta = {
  title: "Portal/Runs/RunRecordsView",
  component: RunRecordsView,
  args: {
    runs: fixtureRuns,
    sourceLabel: "Fixture fallback",
  },
} satisfies Meta<typeof RunRecordsView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BlockedAndWaiting: Story = {
  args: {
    runs: fixtureRuns.filter(
      (run) => run.status === "blocked" || run.status === "waiting_for_approval",
    ),
    sourceLabel: "Fixture fallback",
  },
};

export const Empty: Story = {
  args: {
    runs: [],
    sourceLabel: "Unavailable",
    emptyDetail: "Run data store unavailable.",
  },
};
