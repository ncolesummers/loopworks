import type { Meta, StoryObj } from "@storybook/nextjs-vite";

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

export const ResearchLoop: Story = {
  args: {
    initialRunId: "fixture-run-research",
    runs: fixtureRuns.filter((run) => run.id === "fixture-run-research"),
    sourceLabel: "Fixture fallback",
  },
};

/** A real absence of runs: terminal, because a run is produced by execution, not by the operator. */
export const Empty: Story = {
  args: {
    runs: [],
    sourceLabel: "Live database",
  },
};

/** A failed read: distinct copy and status from a verified absence (ADR 0019). */
export const Unavailable: Story = {
  args: {
    firstRun: { reason: "Run data store unavailable.", status: "unavailable" },
    runs: [],
    sourceLabel: "Unavailable",
  },
};
