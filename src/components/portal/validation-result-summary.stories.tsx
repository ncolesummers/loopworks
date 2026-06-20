import type { Meta, StoryObj } from "@storybook/nextjs";

import { ValidationResultSummary } from "@/components/portal/validation-result-summary";
import { portalFixture } from "@/lib/fixtures";

const meta = {
  title: "Portal/Runs/ValidationResultSummary",
  component: ValidationResultSummary,
  args: {
    results: portalFixture.validationResults,
  },
} satisfies Meta<typeof ValidationResultSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    results: [],
  },
};

export const StateMatrix: Story = {
  args: {
    results: [
      {
        name: "Typecheck",
        command: "bun run typecheck",
        status: "passed",
        duration: "18s",
        detail: "Strict TypeScript completed without emitting.",
        artifactHref: "https://github.com/ncolesummers/loopworks/actions",
      },
      {
        name: "Storybook",
        command: "bun run storybook:build",
        status: "warning",
        duration: "42s",
        detail: "Component review is ready, but screenshot baselines are deferred.",
      },
      {
        name: "Playwright",
        command: "bun run test:e2e",
        status: "failed",
        duration: "1m 12s",
        detail: "A composed portal flow regressed and requires repair.",
      },
      {
        name: "Preview deploy",
        command: "vercel deploy",
        status: "running",
        duration: "Running",
        detail: "Deployment checks are still collecting.",
      },
      {
        name: "Visual baseline",
        command: "deferred",
        status: "skipped",
        duration: "0s",
        detail: "Screenshot baselines wait for stable composed surfaces.",
      },
    ],
  },
};

export const InvalidEvidenceLink: Story = {
  args: {
    results: [
      {
        name: "Unsafe evidence",
        command: "bun run unsafe",
        status: "failed",
        duration: "1s",
        detail: "Unsafe evidence URLs render as failed metadata.",
        artifactHref: "javascript:alert(1)",
      },
    ],
  },
};
