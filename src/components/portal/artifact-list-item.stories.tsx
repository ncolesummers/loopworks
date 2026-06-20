import type { Meta, StoryObj } from "@storybook/nextjs";

import { ArtifactListItem } from "@/components/portal/artifact-list-item";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Runs/ArtifactListItem",
  component: ArtifactListItem,
  args: {
    artifact: portalFixture.artifacts[0],
  },
} satisfies Meta<typeof ArtifactListItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Pending: Story = {
  args: {
    artifact: {
      label: "Security review notes",
      href: "pending",
      detail: "Approval evidence is queued until the reviewer signs off.",
      state: "pending",
      kind: "review",
    },
  },
};

export const Failed: Story = {
  args: {
    artifact: {
      label: "Validation log",
      href: "https://github.com/ncolesummers/loopworks/actions",
      detail: "The latest validation artifact failed and needs investigation.",
      state: "failed",
      kind: "log",
    },
  },
};

export const InvalidLink: Story = {
  args: {
    artifact: {
      label: "Unsafe artifact",
      href: "javascript:alert(1)",
      detail: "Unsafe URLs render as disabled text with a failed status.",
      state: "available",
      kind: "log",
    },
  },
};
