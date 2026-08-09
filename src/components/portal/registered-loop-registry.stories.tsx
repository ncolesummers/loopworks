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

/** First run, no GitHub App yet: the earliest activation step this surface can name. */
export const FirstRunNoInstallation: Story = {
  args: {
    firstRun: { stage: "no-installation", status: "onboarding" },
    loops: [],
    sourceLabel: "Live database",
  },
};

/** App installed, no repositories selected: a loop cannot be scoped yet. */
export const FirstRunNoRepositories: Story = {
  args: {
    firstRun: { stage: "no-repositories", status: "onboarding" },
    loops: [],
    sourceLabel: "Live database",
  },
};

/** Repositories tracked, no loop registered: the step this surface exists for. */
export const FirstRunNoLoops: Story = {
  args: {
    firstRun: { stage: "no-loops", status: "onboarding" },
    loops: [],
    sourceLabel: "Live database",
  },
};

/** A failed read renders no call to action at all (ADR 0019). */
export const Unavailable: Story = {
  args: {
    firstRun: { reason: "Portal data store unavailable.", status: "unavailable" },
    loops: [],
    sourceLabel: "Unavailable",
  },
};
