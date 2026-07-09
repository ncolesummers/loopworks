import type { Meta, StoryObj } from "@storybook/nextjs";

import { ValidationGateSummary } from "@/components/portal/validation-gate-summary";
import type { ValidationGateSummaryRecord } from "@/lib/types";

const passedGate: ValidationGateSummaryRecord["gates"][number] = {
  command: "bun run format:check",
  detail: "Biome formatting passed.",
  duration: "1.8s",
  key: "format",
  name: "Format check",
  outcome: "pass",
  phase: "before_review",
  rawArtifactHref: "https://github.com/ncolesummers/loopworks/actions/runs/76-format",
  required: true,
};

const failedGate: ValidationGateSummaryRecord["gates"][number] = {
  command: "bun run test",
  detail: "A focused unit test failed.",
  duration: "1m 12s",
  key: "unit-tests",
  name: "Unit tests",
  outcome: "fail",
  phase: "before_review",
  rawArtifactHref: "https://github.com/ncolesummers/loopworks/actions/runs/76-unit",
  required: true,
};

const skippedGate: ValidationGateSummaryRecord["gates"][number] = {
  command: "bun run test:e2e",
  detail: "No browser-impacting change in this fixture.",
  duration: "0s",
  key: "playwright",
  name: "Playwright",
  outcome: "skipped",
  phase: "before_rollout",
  required: false,
};

function summary(
  gates: ValidationGateSummaryRecord["gates"],
  detail = "Validation report: gate summary fixture.",
): ValidationGateSummaryRecord {
  return {
    detail,
    generatedAt: "2026-07-08T16:00:00.000Z",
    gates,
    state: gates.length > 0 ? "ready" : "empty",
  };
}

const meta = {
  title: "Portal/Runs/ValidationGateSummary",
  component: ValidationGateSummary,
  args: {
    summary: summary([passedGate, failedGate, skippedGate]),
  },
} satisfies Meta<typeof ValidationGateSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};

export const Passed: Story = {
  args: {
    summary: summary([passedGate], "Validation report: 1 passed, 0 failed, 0 skipped."),
  },
};

export const Failed: Story = {
  args: {
    summary: summary([failedGate], "Validation report: 0 passed, 1 failed, 0 skipped."),
  },
};

export const Skipped: Story = {
  args: {
    summary: summary([skippedGate], "Validation report: 0 passed, 0 failed, 1 skipped."),
  },
};

export const Empty: Story = {
  args: {
    summary: {
      detail: "No validation gates have completed for this run yet.",
      gates: [],
      state: "empty",
    },
  },
};

export const Loading: Story = {
  args: {
    loading: true,
    summary: {
      detail: "Validation gates are loading.",
      gates: [],
      state: "empty",
    },
  },
};

export const ErrorState: Story = {
  args: {
    summary: {
      detail: "Validation report metadata could not be parsed.",
      gates: [],
      state: "error",
    },
  },
};

export const NoRawArtifact: Story = {
  args: {
    summary: summary([{ ...passedGate, rawArtifactHref: undefined }]),
  },
};

export const InvalidRawArtifactLink: Story = {
  args: {
    summary: summary([{ ...failedGate, rawArtifactHref: "javascript:alert(1)" }]),
  },
};
