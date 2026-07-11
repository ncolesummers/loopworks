import { createHash } from "node:crypto";

import { z } from "zod";

import { defaultLoopManifest } from "@/lib/loops/manifest";

import { type LoopManifest, loopStateValues } from "../schemas/loop-manifest";
import { canonicalJsonStringify } from "./lib/canonical-json";

export const planningAgentModelLabel = "openai/gpt-5.6-sol-xhigh";

export const planningAgentInputSchema = z.object({
  repositoryFullName: z.string().min(1),
  issueNumber: z.number().int().positive(),
  issueUrl: z.url().optional(),
  title: z.string().min(1),
  body: z.string().default(""),
  labels: z.array(z.string().min(1)).default([]),
  milestone: z.string().min(1).nullable().default(null),
  repositoryRevision: z
    .object({
      ref: z.string().min(1),
      commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    })
    .nullable()
    .default(null),
});

export const planningAgentIssueSchema = z.object({
  acceptanceCriteria: z.array(z.string().min(1)),
  labels: z.array(z.string().min(1)),
  milestone: z.string().min(1).nullable(),
  number: z.number().int().positive(),
  repositoryFullName: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
});

export const planningAgentStepSchema = z.object({
  title: z.string().min(1),
  outcome: z.string().min(1),
  owner: z.enum(["agent", "human"]).default("agent"),
  requiresApproval: z.boolean().default(false),
});

export const planningAgentStageSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  owner: z.enum(["agent", "human", "system"]),
  outcome: z.string().min(1),
  approvalRequired: z.boolean().default(false),
  validationGateKeys: z.array(z.string().min(1)).default([]),
});

export const planningAgentValidationGateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  phase: z.enum(["before_implementation", "before_review", "before_rollout"]),
  required: z.boolean(),
  evidence: z.string().min(1),
});

export const planningAgentApprovalPointSchema = z.object({
  key: z.string().min(1),
  required: z.boolean(),
  reviewer: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});

export const planningAgentRiskSchema = z.object({
  key: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string().min(1),
  mitigation: z.string().min(1),
});

export const planningAgentFixtureModeSchema = z.object({
  activationEnv: z.literal("LOOPWORKS_EVE_FIXTURE_MODE"),
  label: z.literal("fixture"),
  productionPolicy: z.literal("fail-closed"),
});

export const planningAgentEvalCoverageSchema = z.object({
  mechanism: z.enum(["golden-fixture", "eve-eval"]),
  command: z.string().min(1),
  covers: z.array(z.string().min(1)).min(1),
});

export const planningAgentToolContractSchema = z.object({
  allowedTools: z.array(
    z.object({
      name: z.string().min(1),
      capability: z.string().min(1),
      mutates: z.boolean(),
      auditFields: z.array(z.string().min(1)).min(1),
    }),
  ),
  blockedCapabilities: z.array(z.string().min(1)).min(1),
  planArtifactOnlyWrite: z.literal(true),
  planningOnly: z.literal(true),
});

export const planningAgentOutputSchema = z.object({
  identity: z.object({
    id: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  summary: z.string().min(1),
  model: z.literal(planningAgentModelLabel),
  issue: planningAgentIssueSchema,
  repositoryRevision: z
    .object({
      ref: z.string().min(1),
      commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    })
    .nullable(),
  initialState: z.enum(loopStateValues).default("planned"),
  checkpoints: z.array(z.string().min(1)).min(1),
  stages: z.array(planningAgentStageSchema).min(1),
  steps: z.array(planningAgentStepSchema).min(1),
  validationGates: z.array(planningAgentValidationGateSchema).min(1),
  approvalPoints: z.array(planningAgentApprovalPointSchema).min(1),
  risks: z.array(planningAgentRiskSchema).min(1),
  fixtureMode: planningAgentFixtureModeSchema,
  evalCoverage: z.array(planningAgentEvalCoverageSchema).min(1),
  toolContractSummary: planningAgentToolContractSchema,
});

export type PlanningAgentInput = z.infer<typeof planningAgentInputSchema>;
export type PlanningAgentOutput = z.infer<typeof planningAgentOutputSchema>;

export const pinnedPlanningAgentOutputSchema = planningAgentOutputSchema.refine(
  (
    plan,
  ): plan is PlanningAgentOutput & {
    repositoryRevision: NonNullable<PlanningAgentOutput["repositoryRevision"]>;
  } => plan.repositoryRevision !== null,
  "Planning artifacts require an inspected, pinned repository revision.",
);

export function computePlanningArtifactDigest(
  artifact: Omit<PlanningAgentOutput, "identity"> & {
    identity?: { id: string; sha256?: string };
  },
): string {
  const canonical = {
    ...artifact,
    identity: artifact.identity ? { id: artifact.identity.id } : undefined,
  };
  return createHash("sha256").update(canonicalJsonStringify(canonical)).digest("hex");
}

export const planningAgentDefinition = {
  name: "planning-agent",
  runtime: "eve",
  description: "Creates an initial execution plan from an agent-ready GitHub issue.",
  instructions: [
    "Read the GitHub issue as the canonical work definition.",
    "Preserve milestone and label intent from the loop manifest.",
    "Return a structured executable plan artifact with validation gates, approval points, and risks.",
    "Use guarded read-only CLI inspection only for SaaS context gathering.",
    "Emit sanitized structured logs at orchestration boundaries.",
    "Do not mutate source systems or repository files directly from the planning phase.",
  ].join("\n"),
};

function buildCheckpoints(input: PlanningAgentInput): string[] {
  const checkpoints = ["Plan recorded", "Validation scoped"];

  if (input.labels.some((label) => label.startsWith("area:design-system"))) {
    checkpoints.push("Design direction confirmed");
  }

  if (input.labels.some((label) => label.startsWith("kind:security"))) {
    checkpoints.push("Security review required");
  }

  return checkpoints;
}

function getIssueUrl(input: PlanningAgentInput): string {
  return (
    input.issueUrl ?? `https://github.com/${input.repositoryFullName}/issues/${input.issueNumber}`
  );
}

export function extractAcceptanceCriteria(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const criteria: string[] = [];
  let inAcceptanceCriteria = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+acceptance criteria\s*$/i.test(trimmed)) {
      inAcceptanceCriteria = true;
      continue;
    }

    if (inAcceptanceCriteria && /^#{1,6}\s+/.test(trimmed)) {
      break;
    }

    if (!inAcceptanceCriteria) {
      continue;
    }

    const match = trimmed.match(/^[-*]\s+(.+)$/);
    if (match?.[1]) {
      criteria.push(match[1].trim());
    }
  }

  return criteria;
}

export function buildPlanningAgentPrompt(
  input: PlanningAgentInput,
  manifest: LoopManifest = defaultLoopManifest,
): string {
  const parsed = planningAgentInputSchema.parse(input);

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

export function createPlanningAgentSeedPlan(input: PlanningAgentInput): PlanningAgentOutput {
  const parsed = planningAgentInputSchema.parse(input);
  const checkpoints = buildCheckpoints(parsed);
  const acceptanceCriteria = extractAcceptanceCriteria(parsed.body);
  const issueUrl = getIssueUrl(parsed);

  const planWithoutDigest = {
    identity: {
      id: `plan:${parsed.repositoryFullName}#${parsed.issueNumber}`,
    },
    summary: `Initial plan for issue #${parsed.issueNumber} in ${parsed.repositoryFullName}.`,
    model: planningAgentModelLabel,
    issue: {
      acceptanceCriteria,
      labels: parsed.labels,
      milestone: parsed.milestone,
      number: parsed.issueNumber,
      repositoryFullName: parsed.repositoryFullName,
      title: parsed.title,
      url: issueUrl,
    },
    repositoryRevision: parsed.repositoryRevision,
    initialState: "planned",
    checkpoints,
    stages: [
      {
        key: "resolve-issue",
        title: "Resolve issue context",
        owner: "agent",
        outcome: "Canonical GitHub issue context and acceptance criteria are captured.",
        validationGateKeys: ["focused-agent-tests"],
      },
      {
        key: "plan-artifact",
        title: "Emit plan artifact",
        owner: "agent",
        outcome: "A typed executable plan artifact is generated without source mutation.",
        validationGateKeys: ["focused-agent-tests", "eve-eval-discovery"],
      },
      {
        key: "validation-scope",
        title: "Scope validation",
        owner: "agent",
        outcome: "Focused, aggregate, and eval validation gates are listed before review.",
        validationGateKeys: ["focused-agent-tests", "aggregate-validate"],
      },
      {
        key: "approval-review",
        title: "Request maintainer review",
        owner: "human",
        outcome: "Human approval gates are explicit before any future external write path.",
        approvalRequired: true,
      },
      {
        key: "handoff",
        title: "Handoff",
        owner: "human",
        outcome: "Validation evidence, risks, and follow-ups are ready for maintainer review.",
        validationGateKeys: ["aggregate-validate", "runtime-build"],
      },
    ],
    steps: [
      {
        title: "Resolve issue context",
        outcome:
          "Issue scope, labels, milestone, and acceptance criteria are reflected in the plan.",
        owner: "agent",
      },
      {
        title: "Emit planning artifact",
        outcome: "The plan is emitted as a typed artifact rather than autonomous code mutation.",
        owner: "agent",
      },
      {
        title: "Run validation and request review",
        outcome: "Focused tests are run and any required approval is surfaced.",
        owner: "human",
        requiresApproval: true,
      },
    ],
    validationGates: [
      {
        key: "focused-agent-tests",
        name: "Focused planning-agent tests",
        command:
          "bun test tests/unit/agent/planning-agent.test.ts tests/unit/agent/planning-tools.test.ts tests/unit/agent/planning-fixture.test.ts tests/unit/agent/planning-observability.test.ts tests/unit/loops/development-run.test.ts",
        phase: "before_implementation",
        required: true,
        evidence: "Red/green unit test output for the planning contract.",
      },
      {
        key: "eve-eval-discovery",
        name: "Eve eval discovery",
        command: "bunx eve eval --list",
        phase: "before_review",
        required: true,
        evidence: "Eval harness discovers the planning eval without selecting a backend.",
      },
      {
        key: "aggregate-validate",
        name: "Aggregate validation",
        command: "bun run validate",
        phase: "before_rollout",
        required: true,
        evidence: "Repository validation gate passes before maintainer review.",
      },
      {
        key: "runtime-build",
        name: "Runtime build",
        command: "bun run build",
        phase: "before_rollout",
        required: true,
        evidence: "Next/Eve runtime configuration remains buildable.",
      },
    ],
    approvalPoints: [
      {
        key: "maintainer-review",
        required: true,
        reviewer: "maintainer",
        evidence: ["plan", "validation_report", "risk_summary"],
        reason: "The planning agent defines future workflow boundaries and tool policy.",
      },
    ],
    risks: [
      {
        key: "unsafe-tool-mutation",
        severity: "high",
        description:
          "CLI access could mutate GitHub, Azure, repository files, or other SaaS state.",
        mitigation:
          "Guard the model-visible bash tool with read-only allowlists and audited rejection.",
      },
      {
        key: "raw-io-leakage",
        severity: "high",
        description:
          "Raw prompts, tool output, or issue bodies could leak into production telemetry.",
        mitigation:
          "Keep production logs sanitized and defer raw IO masking/export decisions to issue #21.",
      },
      {
        key: "fixture-production-fallback",
        severity: "medium",
        description: "Fixture issue context could hide missing production integrations.",
        mitigation: "Require explicit fixture mode and fail closed in production-like runtimes.",
      },
    ],
    fixtureMode: {
      activationEnv: "LOOPWORKS_EVE_FIXTURE_MODE",
      label: "fixture",
      productionPolicy: "fail-closed",
    },
    evalCoverage: [
      {
        mechanism: "golden-fixture",
        command: "bun test tests/unit/agent/planning-agent.test.ts",
        covers: ["plan artifact schema", "acceptance criteria extraction", "tool contract summary"],
      },
      {
        mechanism: "eve-eval",
        command: "bunx eve eval planning --skip-report --timeout 180000",
        covers: ["runtime prompt changes", "model changes", "tool-call regressions"],
      },
    ],
    toolContractSummary: {
      planningOnly: true,
      planArtifactOnlyWrite: true,
      allowedTools: [
        {
          name: "prepare_repository_context",
          capability: "Prepare a read-only isolated checkout pinned to an exact commit.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "list_repository_files",
          capability: "Discover bounded tracked repository paths by safe glob patterns.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "search_repository",
          capability: "Search bounded repository text with path and line provenance.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "read_repository_files",
          capability: "Read bounded file ranges from the pinned repository context.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "read_issue_context",
          capability: "Read supplied GitHub issue context and summarize acceptance criteria.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "summarize_validation_requirements",
          capability: "Map acceptance criteria to deterministic validation gates.",
          mutates: false,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "bash",
          capability: "Run guarded read-only SaaS CLI inspection commands.",
          mutates: false,
          auditFields: ["agent", "commandFamily", "repo", "issue", "run", "step", "traceId"],
        },
        {
          name: "emit_plan_artifact",
          capability: "Emit the validated plan artifact only.",
          mutates: true,
          auditFields: ["agent", "repo", "issue", "run", "step", "traceId"],
        },
      ],
      blockedCapabilities: [
        "repository file writes",
        "branch mutation",
        "GitHub issue/PR mutation",
        "Azure resource mutation",
        "arbitrary web fetch/search",
        "copy-agent delegation",
      ],
    },
  };

  const normalizedPlan = planningAgentOutputSchema.parse({
    ...planWithoutDigest,
    identity: {
      id: planWithoutDigest.identity.id,
      sha256: "0".repeat(64),
    },
  });

  return planningAgentOutputSchema.parse({
    ...normalizedPlan,
    identity: {
      id: normalizedPlan.identity.id,
      sha256: computePlanningArtifactDigest(normalizedPlan),
    },
  });
}
