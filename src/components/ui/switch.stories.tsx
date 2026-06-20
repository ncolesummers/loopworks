import type { Meta, StoryObj } from "@storybook/nextjs";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const meta = {
  title: "UI/Primitives/Switch",
  component: Switch,
  render: () => {
    return (
      <div className="flex items-center gap-3">
        <Switch checked />
        <Label>Enabled</Label>
      </div>
    );
  },
} satisfies Meta<typeof Switch>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
