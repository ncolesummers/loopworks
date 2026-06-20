import { z } from "zod";

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

export const labelCategoryValues = [
  "kind",
  "priority",
  "area",
  "status",
  "milestone",
  "custom",
] as const;

const repoSlugSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Expected owner/repo format.");

const issueTemplateSchema = z.object({
  title: z.string().min(1),
  labels: z.array(z.string().min(1)).min(1),
  template: z.string().min(1),
});

const labelSchema = z.object({
  name: z.string().min(1),
  category: z.enum(labelCategoryValues),
  description: z.string().min(1).optional(),
  required: z.boolean().optional(),
});

const milestoneSchema = z.object({
  key: z.string().regex(/^M\d+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  issues: z.array(issueTemplateSchema).default([]),
});

const agentReadySchema = z.object({
  readyLabels: z.array(z.string().min(1)).min(1).default(["status:ready"]),
  blockedLabels: z.array(z.string().min(1)).min(1).default(["status:blocked"]),
  requiredLabelPrefixes: z.array(z.string().min(1)).min(1).default(["area:", "priority:"]),
  requiresMilestone: z.boolean().default(true),
  requiresBody: z.boolean().default(true),
});

export const loopManifestSchema = z.object({
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
  milestones: z.array(milestoneSchema).min(1),
  labels: z.array(labelSchema).min(1),
  agentReady: agentReadySchema.default({
    readyLabels: ["status:ready"],
    blockedLabels: ["status:blocked"],
    requiredLabelPrefixes: ["area:", "priority:"],
    requiresMilestone: true,
    requiresBody: true,
  }),
});

export type LoopState = (typeof loopStateValues)[number];
export type RequiredMetadata = (typeof requiredMetadataValues)[number];
export type LabelCategory = (typeof labelCategoryValues)[number];
export type LoopManifest = z.infer<typeof loopManifestSchema>;
