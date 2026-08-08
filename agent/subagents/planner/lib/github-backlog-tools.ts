import { z } from "zod";
import { resolvePlanningAgentFixtureMode } from "../../../lib/fixture-mode";
import {
  createGithubPlanningBacklogReader,
  GithubPlanningBacklogError,
  type GithubPlanningBacklogReader,
  githubBacklogItemOutputSchema,
  githubBacklogListOutputSchema,
  githubBacklogTaxonomyOutputSchema,
} from "../../../lib/github-backlog-reader";
import {
  type PlanningToolObservation,
  type PlanningToolObservationInput,
  startPlanningToolObservation,
} from "../../../lib/planning-observability";
import { type RunGithubBinding, resolveRunGithubBinding } from "../../../lib/run-github-binding";

const runIdSchema = z.string().uuid();
const labelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[,\n\r]/.test(value), "Labels cannot contain separators.");

export const listGithubBacklogInputSchema = z
  .object({
    labels: z.array(labelSchema).max(5).default([]),
    limit: z.number().int().min(1).max(100).default(50),
    milestoneNumber: z.number().int().positive().optional(),
    state: z.enum(["all", "closed", "open"]).default("open"),
  })
  .strict();

export const readGithubBacklogItemInputSchema = z
  .object({
    commentLimit: z.number().int().min(0).max(20).default(10),
    issueNumber: z.number().int().positive().optional(),
  })
  .strict();

export const listGithubBacklogTaxonomyInputSchema = z.object({}).strict();

export {
  githubBacklogItemOutputSchema,
  githubBacklogListOutputSchema,
  githubBacklogTaxonomyOutputSchema,
};

type ToolDependencies = {
  activeRunId?: string;
  fixtureMode?: boolean;
  observe?: (input: PlanningToolObservationInput) => PlanningToolObservation;
  reader?: GithubPlanningBacklogReader;
  resolveBinding?: (runId: string) => Promise<RunGithubBinding>;
};

function dependencies(input: ToolDependencies) {
  return {
    fixtureMode: input.fixtureMode ?? resolvePlanningAgentFixtureMode().enabled,
    observe: input.observe ?? startPlanningToolObservation,
    reader: input.reader ?? createGithubPlanningBacklogReader(),
    resolveBinding: input.resolveBinding ?? resolveRunGithubBinding,
    activeRunId: input.activeRunId,
  };
}

const fixtureIssue = {
  assigneeLogins: [],
  authorAssociation: "OWNER",
  authorLogin: "ncolesummers",
  closedAt: "2026-07-03T00:00:00.000Z",
  commentCount: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  labels: ["area:agents", "priority:p1"],
  milestone: null,
  number: 13,
  state: "closed" as const,
  stateReason: "completed",
  title: "Initial Eve planning agent",
  updatedAt: "2026-07-03T00:00:00.000Z",
  url: "https://github.com/ncolesummers/loopworks/issues/13",
};

function fixtureList() {
  return githubBacklogListOutputSchema.parse({
    fetchedAt: "2026-07-03T00:00:00.000Z",
    issues: [fixtureIssue],
    provenance: "untrusted_external_evidence",
    repositoryFullName: "ncolesummers/loopworks",
    truncated: false,
  });
}

function fixtureItem() {
  return githubBacklogItemOutputSchema.parse({
    body: "Fixture issue context for deterministic planning evaluation.",
    comments: [],
    fetchedAt: "2026-07-03T00:00:00.000Z",
    issue: fixtureIssue,
    provenance: "untrusted_external_evidence",
    relationships: { blockedBy: [], blocking: [], parent: null, subIssues: [] },
    repositoryFullName: "ncolesummers/loopworks",
    truncation: {
      blockedBy: false,
      blocking: false,
      body: false,
      comments: false,
      issue: false,
      parent: false,
      subIssues: false,
    },
  });
}

function fixtureTaxonomy() {
  return githubBacklogTaxonomyOutputSchema.parse({
    fetchedAt: "2026-07-03T00:00:00.000Z",
    labels: [
      { description: "Agent orchestration and runtime behavior.", name: "area:agents" },
      { description: "High priority after P0 work.", name: "priority:p1" },
    ],
    milestones: [],
    provenance: "untrusted_external_evidence",
    repositoryFullName: "ncolesummers/loopworks",
    truncation: { labels: false, milestones: false },
  });
}

function observationInput(runId: string, tool: string): PlanningToolObservationInput {
  return {
    provider: "github",
    runId,
    tool,
  };
}

const stableBindingErrors = new Set([
  "run_github_session_unbound",
  "run_github_binding_failed",
  "run_github_binding_missing",
  "run_github_installation_unbound",
  "run_github_issue_unbound",
  "run_github_repository_invalid",
]);

function activeRunId(value: string | undefined): string {
  const parsed = runIdSchema.safeParse(value);
  if (!parsed.success) throw new Error("run_github_session_unbound");
  return parsed.data;
}

function sanitizeBindingFailure(error: unknown): Error {
  if (error instanceof Error && stableBindingErrors.has(error.message)) return error;
  return new Error("run_github_binding_failed");
}

function sanitizeProviderFailure(error: unknown): Error {
  if (error instanceof GithubPlanningBacklogError) return error;
  return new Error("github_backlog_tool_failed");
}

export async function executeListGithubBacklog(
  input: z.input<typeof listGithubBacklogInputSchema>,
  injected: ToolDependencies = {},
) {
  const parsed = listGithubBacklogInputSchema.parse(input);
  const resolved = dependencies(injected);
  if (resolved.fixtureMode) return fixtureList();
  const observation = resolved.observe(
    observationInput(resolved.activeRunId ?? "unbound", "list_github_backlog"),
  );
  let binding: RunGithubBinding;
  try {
    const runId = activeRunId(resolved.activeRunId);
    try {
      binding = await resolved.resolveBinding(runId);
    } catch (error) {
      throw sanitizeBindingFailure(error);
    }
    observation.bind({ repositoryFullName: binding.repositoryFullName });
    const result = await resolved.reader.listBacklog({
      installationId: binding.installationId,
      labels: parsed.labels,
      limit: parsed.limit,
      milestoneNumber: parsed.milestoneNumber,
      owner: binding.owner,
      repo: binding.repo,
      state: parsed.state,
    });
    observation.succeed({ count: result.issues.length, truncated: result.truncated });
    return result;
  } catch (error) {
    const sanitized = stableBindingErrors.has(error instanceof Error ? error.message : "")
      ? (error as Error)
      : sanitizeProviderFailure(error);
    observation.fail(sanitized);
    throw sanitized;
  }
}

export async function executeReadGithubBacklogItem(
  input: z.input<typeof readGithubBacklogItemInputSchema>,
  injected: ToolDependencies = {},
) {
  const parsed = readGithubBacklogItemInputSchema.parse(input);
  const resolved = dependencies(injected);
  if (resolved.fixtureMode) return fixtureItem();
  const observation = resolved.observe(
    observationInput(resolved.activeRunId ?? "unbound", "read_github_backlog_item"),
  );
  let binding: RunGithubBinding;
  try {
    const runId = activeRunId(resolved.activeRunId);
    try {
      binding = await resolved.resolveBinding(runId);
    } catch (error) {
      throw sanitizeBindingFailure(error);
    }
    const issueNumber = parsed.issueNumber ?? binding.issueNumber;
    observation.bind({ issueNumber, repositoryFullName: binding.repositoryFullName });
    const result = await resolved.reader.readBacklogItem({
      commentLimit: parsed.commentLimit,
      installationId: binding.installationId,
      issueNumber,
      owner: binding.owner,
      repo: binding.repo,
    });
    const count =
      1 +
      result.comments.length +
      result.relationships.blockedBy.length +
      result.relationships.blocking.length +
      result.relationships.subIssues.length +
      (result.relationships.parent ? 1 : 0);
    observation.succeed({
      count,
      truncated: Object.values(result.truncation).some(Boolean),
    });
    return result;
  } catch (error) {
    const sanitized = stableBindingErrors.has(error instanceof Error ? error.message : "")
      ? (error as Error)
      : sanitizeProviderFailure(error);
    observation.fail(sanitized);
    throw sanitized;
  }
}

export async function executeListGithubBacklogTaxonomy(
  input: z.input<typeof listGithubBacklogTaxonomyInputSchema>,
  injected: ToolDependencies = {},
) {
  listGithubBacklogTaxonomyInputSchema.parse(input);
  const resolved = dependencies(injected);
  if (resolved.fixtureMode) return fixtureTaxonomy();
  const observation = resolved.observe(
    observationInput(resolved.activeRunId ?? "unbound", "list_github_backlog_taxonomy"),
  );
  let binding: RunGithubBinding;
  try {
    const runId = activeRunId(resolved.activeRunId);
    try {
      binding = await resolved.resolveBinding(runId);
    } catch (error) {
      throw sanitizeBindingFailure(error);
    }
    observation.bind({ repositoryFullName: binding.repositoryFullName });
    const result = await resolved.reader.listTaxonomy({
      installationId: binding.installationId,
      owner: binding.owner,
      repo: binding.repo,
    });
    observation.succeed({
      count: result.labels.length + result.milestones.length,
      truncated: result.truncation.labels || result.truncation.milestones,
    });
    return result;
  } catch (error) {
    const sanitized = stableBindingErrors.has(error instanceof Error ? error.message : "")
      ? (error as Error)
      : sanitizeProviderFailure(error);
    observation.fail(sanitized);
    throw sanitized;
  }
}
