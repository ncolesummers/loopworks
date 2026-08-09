import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { portalEmptyState } from "@/components/portal/empty-states";
import {
  DisabledState,
  EmptyState,
  ErrorState,
  LoadingState,
  ReusableStates,
  UnauthorizedState,
} from "@/components/portal/reusable-states";

const meta = {
  title: "States/ReusableStates",
  component: ReusableStates,
} satisfies Meta<typeof ReusableStates>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  render: () => <LoadingState />,
};

/** First-run emptiness: routes to the activation step it names. */
export const Empty: Story = {
  render: () => <EmptyState spec={portalEmptyState("onboarding-no-loops")} />,
};

/**
 * Operator-caused emptiness: reversible in place, so it offers a reset instead of a route. The
 * handler is required for the button to render at all - a reset with nowhere to go would be the
 * same dead end this pattern exists to remove.
 */
export const EmptyWithReset: Story = {
  render: () => (
    <EmptyState onReset={() => {}} spec={portalEmptyState("catalog-no-filter-matches")} />
  ),
};

/** Terminal emptiness: no next step exists, and the state says so rather than naming one. */
export const EmptyTerminal: Story = {
  render: () => <EmptyState spec={portalEmptyState("runs-none")} />,
};

/** A failed read: distinct copy from first run, and deliberately no call to action. */
export const EmptyUnavailable: Story = {
  render: () => (
    <EmptyState
      detail="Portal data store unavailable."
      spec={portalEmptyState("portal-unavailable")}
    />
  ),
};

export const ErrorPanel: Story = {
  render: () => <ErrorState />,
};

export const Disabled: Story = {
  render: () => <DisabledState />,
};

export const Unauthorized: Story = {
  render: () => <UnauthorizedState />,
};
