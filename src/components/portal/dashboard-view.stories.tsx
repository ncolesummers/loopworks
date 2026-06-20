import type { Meta, StoryObj } from "@storybook/nextjs";

import { DashboardView } from "@/components/portal/dashboard-view";

const meta = {
  title: "Portal/Shell/Dashboard",
  component: DashboardView,
} satisfies Meta<typeof DashboardView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
