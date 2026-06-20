import type { Meta, StoryObj } from "@storybook/nextjs";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

const meta = {
  title: "UI/Primitives/Button",
  component: Button,
  args: {
    children: "Primary action",
  },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithIcon: Story = {
  args: {
    children: (
      <>
        Continue
        <ArrowRight className="h-4 w-4" />
      </>
    ),
  },
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
    </div>
  ),
};
