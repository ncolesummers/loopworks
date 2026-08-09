import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { LoopRegistrationView } from "@/components/portal/loop-registration-view";
import { loopRegistrationFixture } from "@/lib/fixtures";
import type { LoopRegistrationResult } from "@/lib/loops/loop-registration-flow";

const noop = async (): Promise<LoopRegistrationResult> => ({
  loopKey: "development-loop",
  status: "registered",
});

const meta = {
  title: "Portal/Loops/LoopRegistration",
  component: LoopRegistrationView,
  args: { register: noop, snapshot: loopRegistrationFixture },
  parameters: { layout: "padded" },
} satisfies Meta<typeof LoopRegistrationView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = { args: { loading: true } };

export const NoTrackedRepositories: Story = {
  args: { snapshot: { status: "no-tracked-repositories" } },
};

export const ErrorPanel: Story = {
  args: { snapshot: { reason: "loop_registration_unavailable", status: "error" } },
};

export const FixtureMode: Story = { args: { fixtureMode: true } };

export const ValidationErrors: Story = {
  args: {
    register: async () => ({
      errors: [
        {
          hint: "Add at least one GitHub label that can trigger the loop, such as agent-ready.",
          message: "Too small: expected array to have >=1 items",
          path: "triggers.issueLabels",
        },
      ],
      status: "invalid",
    }),
  },
};

export const DuplicateKey: Story = {
  args: { register: async () => ({ status: "duplicate-key" }) },
};

export const SingleRepository: Story = {
  args: {
    snapshot: {
      repositories: loopRegistrationFixture.repositories?.slice(0, 1) ?? [],
      status: "ready",
    },
  },
};
