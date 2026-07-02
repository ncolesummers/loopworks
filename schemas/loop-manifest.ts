import { z } from "zod";

export const loopManifestVersionValues = [1] as const;

export const loopStateValues = [
  "intake",
  "triage",
  "planned",
  "in_progress",
  "waiting_on_review",
  "validating",
  "blocked",
  "done",
] as const;

export const requiredMetadataValues = [
  "repo",
  "milestone",
  "area",
  "priority",
  "state",
  "last_synced_at",
  "source_links",
] as const;

export const personaTestIdValues = [
  "P01",
  "P02",
  "P03",
  "P04",
  "M01",
  "M02",
  "M03",
  "A01",
  "A02",
  "A03",
  "R01",
  "R02",
  "S01",
  "S02",
  "S03",
  "S04",
] as const;

export const labelCategoryValues = [
  "kind",
  "priority",
  "area",
  "status",
  "milestone",
  "custom",
] as const;

export const issueTriggerStateValues = ["opened", "reopened", "labeled", "edited"] as const;

export const toolCategoryValues = [
  "repo-read",
  "repo-write",
  "github",
  "browser",
  "validation",
  "deployment",
] as const;

export const approvalRequirementValues = [
  "external_write",
  "approval_transition",
  "pr_creation",
  "deployment_change",
  "manifest_rollout",
] as const;

export const approvalBypassPolicyValues = ["none", "maintainer_override"] as const;

export const artifactContractTypeValues = [
  "plan",
  "validation_report",
  "patch",
  "pr_intent",
  "summary",
  "diff_summary",
  "trace",
] as const;

export const artifactRetentionValues = ["run", "pr", "audit"] as const;

export const validationGatePhaseValues = [
  "before_implementation",
  "before_review",
  "before_rollout",
] as const;

export const backoffStrategyValues = ["fixed", "exponential"] as const;

export const cancellationOnSupersededValues = ["mark_canceled", "continue_existing"] as const;

export const cancellationOnDisabledValues = ["skip_new_runs", "cancel_running"] as const;

export const githubWritebackChannelValues = ["issue_comment", "label", "status_check"] as const;

const repoSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/repo format.");

const issueTemplateSchema = z
  .object({
    title: z.string().min(1),
    labels: z.array(z.string().min(1)).min(1),
    template: z.string().min(1),
    personaTestIds: z.array(z.enum(personaTestIdValues)).min(1),
  })
  .strict();

const labelSchema = z
  .object({
    name: z.string().min(1),
    category: z.enum(labelCategoryValues),
    description: z.string().min(1).optional(),
    required: z.boolean().optional(),
  })
  .strict();

const milestoneSchema = z
  .object({
    key: z.string().regex(/^M\d+$/),
    name: z.string().min(1),
    description: z.string().min(1),
    personaTestIds: z.array(z.enum(personaTestIdValues)).min(1),
    issues: z.array(issueTemplateSchema).default([]),
  })
  .strict();

const agentReadySchema = z
  .object({
    readyLabels: z.array(z.string().min(1)).min(1).default(["status:ready"]),
    blockedLabels: z.array(z.string().min(1)).min(1).default(["status:blocked"]),
    requiredLabelPrefixes: z.array(z.string().min(1)).min(1).default(["area:", "priority:"]),
    requiresMilestone: z.boolean().default(true),
    requiresBody: z.boolean().default(true),
  })
  .strict();

const branchPatternSchema = z.string().min(1);

const loopRepoScopeSchema = z
  .object({
    repositories: z.array(repoSlugSchema).min(1),
    branchPatterns: z.array(branchPatternSchema).min(1),
    includeForks: z.boolean().default(false),
  })
  .strict();

const loopTriggerScheduleSchema = z
  .object({
    enabled: z.boolean(),
    cron: z.string().min(1).optional(),
    timezone: z.string().min(1).default("UTC"),
  })
  .strict()
  .superRefine((schedule, context) => {
    if (schedule.enabled && schedule.cron === undefined) {
      context.addIssue({
        code: "custom",
        path: ["cron"],
        message: "Cron expression is required when schedule is enabled.",
      });
    }
  });

const loopTriggersSchema = z
  .object({
    issueLabels: z.array(z.string().min(1)).min(1),
    blockedLabels: z.array(z.string().min(1)).default([]),
    issueStates: z
      .array(z.enum(issueTriggerStateValues))
      .min(1)
      .default(["opened", "reopened", "labeled"]),
    manual: z.boolean().default(true),
    schedule: loopTriggerScheduleSchema.default({
      enabled: false,
      timezone: "UTC",
    }),
  })
  .strict();

const loopModelPolicySchema = z
  .object({
    defaultModel: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

const loopToolPolicySchema = z
  .object({
    allowedToolCategories: z.array(z.enum(toolCategoryValues)).min(1),
    externalWritesRequireApproval: z.boolean().default(true),
  })
  .strict();

const loopBudgetSchema = z
  .object({
    maxRunMinutes: z.number().int().min(1),
    maxModelUsd: z.number().positive(),
    maxToolCalls: z.number().int().min(1),
  })
  .strict();

const approvalGateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    required: z.literal(true),
    reviewers: z.array(z.string().min(1)).min(1),
    evidence: z.array(z.enum(artifactContractTypeValues)).min(1),
  })
  .strict();

const loopApprovalsSchema = z
  .object({
    requiredFor: z.array(z.enum(approvalRequirementValues)).min(1),
    bypassPolicy: z.enum(approvalBypassPolicyValues).default("none"),
    gates: z.array(approvalGateSchema).min(1),
  })
  .strict();

const artifactContractSchema = z
  .object({
    type: z.enum(artifactContractTypeValues),
    required: z.boolean(),
    description: z.string().min(1),
    retention: z.enum(artifactRetentionValues).default("run"),
  })
  .strict();

const validationGateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    command: z.string().min(1),
    required: z.boolean(),
    phase: z.enum(validationGatePhaseValues).default("before_review"),
    produces: z.enum(artifactContractTypeValues).default("validation_report"),
  })
  .strict();

const retryBackoffSchema = z
  .object({
    strategy: z.enum(backoffStrategyValues),
    initialSeconds: z.number().int().min(1),
    maxSeconds: z.number().int().min(1),
  })
  .strict();

const retryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1),
    retryableStatuses: z.array(z.enum(["failed", "blocked"])).min(1),
    backoff: retryBackoffSchema,
  })
  .strict();

const concurrencySchema = z
  .object({
    group: z.string().min(1),
    maxInFlight: z.number().int().min(1),
    cancelInProgress: z.boolean().default(false),
  })
  .strict();

const cancellationSchema = z
  .object({
    onSuperseded: z.enum(cancellationOnSupersededValues),
    onDisabled: z.enum(cancellationOnDisabledValues),
    requiresReason: z.boolean().default(true),
  })
  .strict();

const githubWritebackSchema = z
  .object({
    enabled: z.boolean(),
    channels: z.array(z.enum(githubWritebackChannelValues)).default([]),
    requireApprovalForLabels: z.boolean().default(true),
  })
  .strict();

const loopDefinitionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    description: z.string().min(1),
    enabled: z.boolean(),
    repoScope: loopRepoScopeSchema,
    triggers: loopTriggersSchema,
    modelPolicy: loopModelPolicySchema,
    toolPolicy: loopToolPolicySchema,
    budgets: loopBudgetSchema,
    approvals: loopApprovalsSchema,
    artifacts: z.array(artifactContractSchema).min(1),
    validationGates: z.array(validationGateSchema).min(1),
    retryPolicy: retryPolicySchema,
    concurrency: concurrencySchema,
    cancellation: cancellationSchema,
    githubWriteback: githubWritebackSchema,
  })
  .strict();

export const loopManifestSchema = z
  .object({
    version: z.literal(1),
    repo: repoSlugSchema,
    note: z.string().min(1),
    loopStates: z
      .array(z.enum(loopStateValues))
      .min(1)
      .default([...loopStateValues]),
    requiredMetadata: z
      .array(z.enum(requiredMetadataValues))
      .min(1)
      .default([...requiredMetadataValues]),
    loops: z.array(loopDefinitionSchema).min(1),
    milestones: z.array(milestoneSchema).min(1),
    labels: z.array(labelSchema).min(1),
    agentReady: agentReadySchema.default({
      readyLabels: ["status:ready"],
      blockedLabels: ["status:blocked"],
      requiredLabelPrefixes: ["area:", "priority:"],
      requiresMilestone: true,
      requiresBody: true,
    }),
  })
  .strict();

export type LoopManifestVersion = (typeof loopManifestVersionValues)[number];
export type LoopState = (typeof loopStateValues)[number];
export type RequiredMetadata = (typeof requiredMetadataValues)[number];
export type PersonaTestId = (typeof personaTestIdValues)[number];
export type LabelCategory = (typeof labelCategoryValues)[number];
export type LoopManifest = z.infer<typeof loopManifestSchema>;
export type LoopDefinition = LoopManifest["loops"][number];
