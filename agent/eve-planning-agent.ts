import { z } from "zod";

import { defaultLoopManifest } from "@/lib/loops/manifest";

import { type LoopManifest, loopStateValues } from "../schemas/loop-manifest";

export const evePlanningAgentInputSchema = z.object({
  repositoryFullName: z.string().min(1),
  issueNumber: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().default(""),
  labels: z.array(z.string().min(1)).default([]),
  milestone: z.string().min(1).nullable().default(null),
});

export const evePlanningStepSchema = z.object({
  title: z.string().min(1),
  outcome: z.string().min(1),
  owner: z.enum(["agent", "human"]).default("agent"),
  requiresApproval: z.boolean().default(false),
});

export const evePlanningAgentOutputSchema = z.object({
  summary: z.string().min(1),
  initialState: z.enum(loopStateValues).default("planned"),
  checkpoints: z.array(z.string().min(1)).min(1),
  steps: z.array(evePlanningStepSchema).min(1),
});

export type EvePlanningAgentInput = z.infer<typeof evePlanningAgentInputSchema>;
export type EvePlanningAgentOutput = z.infer<typeof evePlanningAgentOutputSchema>;

export const evePlanningAgentDefinition = {
  name: "eve-planning-agent",
  runtime: "eve",
  description: "Creates an initial execution plan from an agent-ready GitHub issue.",
  instructions: [
    "Read the GitHub issue as the canonical work definition.",
    "Preserve milestone and label intent from the loop manifest.",
    "Break work into a short sequence of auditable steps.",
    "Call out checkpoints that require validation or human approval.",
    "Do not mutate source systems directly from the planning phase.",
  ].join("\n"),
};

function buildCheckpoints(input: EvePlanningAgentInput): string[] {
  const checkpoints = ["Plan recorded", "Validation scoped"];

  if (input.labels.some((label) => label.startsWith("area:design-system"))) {
    checkpoints.push("Design direction confirmed");
  }

  if (input.labels.some((label) => label.startsWith("kind:security"))) {
    checkpoints.push("Security review required");
  }

  return checkpoints;
}

export function buildEvePlanningPrompt(
  input: EvePlanningAgentInput,
  manifest: LoopManifest = defaultLoopManifest,
): string {
  const parsed = evePlanningAgentInputSchema.parse(input);

  return [
    `Repository: ${parsed.repositoryFullName}`,
    `Issue: #${parsed.issueNumber} ${parsed.title}`,
    `Milestone: ${parsed.milestone ?? "unassigned"}`,
    `Labels: ${parsed.labels.join(", ") || "none"}`,
    `Allowed loop states: ${manifest.loopStates.join(", ")}`,
    `Required metadata: ${manifest.requiredMetadata.join(", ")}`,
    "",
    "Issue body:",
    parsed.body || "(empty)",
  ].join("\n");
}

export function createEvePlanningSeedPlan(input: EvePlanningAgentInput): EvePlanningAgentOutput {
  const parsed = evePlanningAgentInputSchema.parse(input);
  const checkpoints = buildCheckpoints(parsed);

  return evePlanningAgentOutputSchema.parse({
    summary: `Initial plan for issue #${parsed.issueNumber} in ${parsed.repositoryFullName}.`,
    initialState: "planned",
    checkpoints,
    steps: [
      {
        title: "Clarify scope",
        outcome: "Issue scope, labels, and milestone are reflected in the plan.",
        owner: "agent",
      },
      {
        title: "Implement backend slice",
        outcome: "Code changes are prepared against the current issue scope.",
        owner: "agent",
      },
      {
        title: "Run validation and request review",
        outcome: "Focused tests are run and any required approval is surfaced.",
        owner: "human",
        requiresApproval: true,
      },
    ],
  });
}
