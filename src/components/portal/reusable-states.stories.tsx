import type { Meta, StoryObj } from "@storybook/nextjs";

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

export const Empty: Story = {
  render: () => <EmptyState />,
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
