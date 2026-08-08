import { App } from "@octokit/app";
import { z } from "zod";
import { readStringConfig } from "@/lib/config/registry";

import { redactSecrets } from "./redaction";

const githubApiVersion = "2026-03-10";
const provenance = "untrusted_external_evidence" as const;
const maxIssueBodyLength = 20_000;
const maxCommentBodyLength = 4_000;
const maxRelationshipCount = 50;
const maxLabels = 100;
const maxMilestones = 50;

const nullableTimestampSchema = z.string().datetime().nullable();

export const githubBacklogMilestoneSummarySchema = z.object({
  dueOn: nullableTimestampSchema,
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  title: z.string().max(500),
});

export const githubBacklogIssueSummarySchema = z.object({
  assigneeLogins: z.array(z.string().max(100)).max(20),
  authorAssociation: z.string().max(64).nullable(),
  authorLogin: z.string().max(100).nullable(),
  closedAt: nullableTimestampSchema,
  commentCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  labels: z.array(z.string().max(100)).max(20),
  milestone: githubBacklogMilestoneSummarySchema.nullable(),
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  stateReason: z.string().max(64).nullable(),
  title: z.string().max(500),
  updatedAt: z.string().datetime(),
  url: z.string().url(),
});

export const githubBacklogListOutputSchema = z.object({
  fetchedAt: z.string().datetime(),
  issues: z.array(githubBacklogIssueSummarySchema).max(100),
  provenance: z.literal(provenance),
  repositoryFullName: z.string().max(201),
  truncated: z.boolean(),
});

const githubBacklogCommentSchema = z.object({
  authorAssociation: z.string().max(64).nullable(),
  authorLogin: z.string().max(100).nullable(),
  body: z.string().max(maxCommentBodyLength),
  createdAt: z.string().datetime(),
  id: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  url: z.string().url(),
});

export const githubBacklogItemOutputSchema = z.object({
  body: z.string().max(maxIssueBodyLength),
  comments: z.array(githubBacklogCommentSchema).max(20),
  fetchedAt: z.string().datetime(),
  issue: githubBacklogIssueSummarySchema,
  provenance: z.literal(provenance),
  relationships: z.object({
    blockedBy: z.array(githubBacklogIssueSummarySchema).max(maxRelationshipCount),
    blocking: z.array(githubBacklogIssueSummarySchema).max(maxRelationshipCount),
    parent: githubBacklogIssueSummarySchema.nullable(),
    subIssues: z.array(githubBacklogIssueSummarySchema).max(maxRelationshipCount),
  }),
  repositoryFullName: z.string().max(201),
  truncation: z.object({
    blockedBy: z.boolean(),
    blocking: z.boolean(),
    body: z.boolean(),
    comments: z.boolean(),
    issue: z.boolean(),
    parent: z.boolean(),
    subIssues: z.boolean(),
  }),
});

const githubBacklogLabelSchema = z.object({
  description: z.string().max(500).nullable(),
  name: z.string().max(100),
});

const githubBacklogTaxonomyMilestoneSchema = githubBacklogMilestoneSummarySchema.extend({
  closedIssues: z.number().int().nonnegative(),
  description: z.string().max(2_000).nullable(),
  openIssues: z.number().int().nonnegative(),
});

export const githubBacklogTaxonomyOutputSchema = z.object({
  fetchedAt: z.string().datetime(),
  labels: z.array(githubBacklogLabelSchema).max(maxLabels),
  milestones: z.array(githubBacklogTaxonomyMilestoneSchema).max(maxMilestones),
  provenance: z.literal(provenance),
  repositoryFullName: z.string().max(201),
  truncation: z.object({ labels: z.boolean(), milestones: z.boolean() }),
});

export type GithubBacklogListOutput = z.infer<typeof githubBacklogListOutputSchema>;
export type GithubBacklogItemOutput = z.infer<typeof githubBacklogItemOutputSchema>;
export type GithubBacklogTaxonomyOutput = z.infer<typeof githubBacklogTaxonomyOutputSchema>;

type GithubRequestResponse = {
  data: unknown;
  headers?: Record<string, string | undefined>;
};

export type GithubPlanningBacklogClient = {
  request(route: string, parameters: Record<string, unknown>): Promise<GithubRequestResponse>;
};

type RepositoryIdentity = {
  installationId: number;
  owner: string;
  repo: string;
};

export type GithubPlanningBacklogReader = {
  listBacklog(
    input: RepositoryIdentity & {
      labels?: string[];
      limit: number;
      milestoneNumber?: number;
      state?: "all" | "closed" | "open";
    },
  ): Promise<GithubBacklogListOutput>;
  listTaxonomy(input: RepositoryIdentity): Promise<GithubBacklogTaxonomyOutput>;
  readBacklogItem(
    input: RepositoryIdentity & { commentLimit: number; issueNumber: number },
  ): Promise<GithubBacklogItemOutput>;
};

export class GithubPlanningBacklogError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GithubPlanningBacklogError";
  }
}

type ReaderDependencies = {
  appCredentials?: { appId: number; privateKey: string };
  getInstallationClient?: (installationId: number) => Promise<GithubPlanningBacklogClient>;
  now?: () => Date;
};

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function nonnegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  return value;
}

function positiveInteger(value: unknown): number {
  const result = nonnegativeInteger(value);
  if (result === 0) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  return result;
}

function timestamp(value: unknown): string {
  const validated = z.string().datetime({ offset: true }).safeParse(requiredString(value));
  if (!validated.success) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  return new Date(validated.data).toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined ? null : timestamp(value);
}

function sanitizeText(value: string, maxLength: number): { truncated: boolean; value: string } {
  const redacted = redactSecrets(value);
  return {
    truncated: redacted.length > maxLength,
    value: redacted.slice(0, maxLength),
  };
}

function normalizeLogin(value: unknown): { truncated: boolean; value: string | null } {
  const login = object(value)?.login;
  if (login === null || login === undefined) return { truncated: false, value: null };
  return sanitizeText(requiredString(login), 100);
}

function normalizeMilestone(value: unknown): {
  truncated: boolean;
  value: z.infer<typeof githubBacklogMilestoneSummarySchema> | null;
} {
  if (value === null || value === undefined) return { truncated: false, value: null };
  const data = object(value);
  if (!data || (data.state !== "open" && data.state !== "closed")) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  const title = sanitizeText(requiredString(data.title), 500);
  return {
    truncated: title.truncated,
    value: githubBacklogMilestoneSummarySchema.parse({
      dueOn: nullableTimestamp(data.due_on),
      number: positiveInteger(data.number),
      state: data.state,
      title: title.value,
    }),
  };
}

function repositoryFullName(input: RepositoryIdentity): string {
  return `${input.owner}/${input.repo}`;
}

function normalizeIssueSummary(
  value: unknown,
  input: RepositoryIdentity,
): { truncated: boolean; value: z.infer<typeof githubBacklogIssueSummarySchema> } {
  const data = object(value);
  if (!data || (data.state !== "open" && data.state !== "closed")) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  const number = positiveInteger(data.number);
  const expectedRepositoryUrl = `https://api.github.com/repos/${input.owner}/${input.repo}`;
  if (requiredString(data.repository_url).toLowerCase() !== expectedRepositoryUrl.toLowerCase()) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  const title = sanitizeText(requiredString(data.title), 500);
  let fieldTruncated = title.truncated;
  const labels = array(data.labels)
    .slice(0, 20)
    .map((label) => {
      const raw = typeof label === "string" ? label : object(label)?.name;
      const normalized = sanitizeText(requiredString(raw), 100);
      fieldTruncated ||= normalized.truncated;
      return normalized.value;
    });
  const assignees = array(data.assignees)
    .slice(0, 20)
    .map((assignee) => {
      const login = normalizeLogin(assignee);
      if (!login.value) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
      fieldTruncated ||= login.truncated;
      return login.value;
    });
  const authorLogin = normalizeLogin(data.user);
  const authorAssociation =
    data.author_association === null || data.author_association === undefined
      ? null
      : sanitizeText(requiredString(data.author_association), 64);
  const stateReason =
    data.state_reason === null || data.state_reason === undefined
      ? null
      : sanitizeText(requiredString(data.state_reason), 64);
  const milestone = normalizeMilestone(data.milestone);
  fieldTruncated ||=
    authorAssociation?.truncated === true ||
    authorLogin.truncated ||
    stateReason?.truncated === true ||
    milestone.truncated ||
    array(data.labels).length > 20 ||
    array(data.assignees).length > 20;
  return {
    truncated: fieldTruncated,
    value: githubBacklogIssueSummarySchema.parse({
      assigneeLogins: assignees,
      authorAssociation: authorAssociation?.value ?? null,
      authorLogin: authorLogin.value,
      closedAt: nullableTimestamp(data.closed_at),
      commentCount: nonnegativeInteger(data.comments),
      createdAt: timestamp(data.created_at),
      labels,
      milestone: milestone.value,
      number,
      state: data.state,
      stateReason: stateReason?.value ?? null,
      title: title.value,
      updatedAt: timestamp(data.updated_at),
      url: `https://github.com/${input.owner}/${input.repo}/issues/${number}`,
    }),
  };
}

function hasNextPage(headers: GithubRequestResponse["headers"]): boolean {
  const link = headers?.link ?? headers?.Link;
  return typeof link === "string" && /rel="next"/.test(link);
}

function requestParameters(input: RepositoryIdentity): Record<string, unknown> {
  return {
    headers: { "x-github-api-version": githubApiVersion },
    owner: input.owner,
    repo: input.repo,
  };
}

function providerFailure(error: unknown): never {
  if (error instanceof GithubPlanningBacklogError) throw error;
  if (error instanceof z.ZodError) {
    throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
  }
  throw new GithubPlanningBacklogError("github_backlog_provider_failed");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function createDefaultClientFactory(
  credentials?: ReaderDependencies["appCredentials"],
): (installationId: number) => Promise<GithubPlanningBacklogClient> {
  const appId = credentials?.appId ?? Number(readStringConfig("GITHUB_APP_ID"));
  const privateKey = credentials?.privateKey ?? readStringConfig("GITHUB_APP_PRIVATE_KEY");
  if (!Number.isSafeInteger(appId) || appId <= 0 || !privateKey) {
    return async () => {
      throw new GithubPlanningBacklogError("github_backlog_configuration_missing");
    };
  }
  const app = new App({ appId, privateKey: privateKey.replaceAll("\\n", "\n") });
  const clients = new Map<number, Promise<GithubPlanningBacklogClient>>();
  return (installationId) => {
    let client = clients.get(installationId);
    if (!client) {
      client = app.getInstallationOctokit(installationId) as Promise<GithubPlanningBacklogClient>;
      client.catch(() => clients.delete(installationId));
      clients.set(installationId, client);
    }
    return client;
  };
}

export function createGithubPlanningBacklogReader(
  dependencies: ReaderDependencies = {},
): GithubPlanningBacklogReader {
  const getInstallationClient =
    dependencies.getInstallationClient ?? createDefaultClientFactory(dependencies.appCredentials);
  const now = dependencies.now ?? (() => new Date());

  return {
    async listBacklog(input) {
      try {
        const client = await getInstallationClient(input.installationId);
        const limit = Math.min(100, Math.max(1, input.limit));
        const response = await client.request("GET /repos/{owner}/{repo}/issues", {
          ...requestParameters(input),
          direction: "desc",
          labels: input.labels?.join(",") ?? "",
          ...(input.milestoneNumber === undefined
            ? {}
            : { milestone: String(input.milestoneNumber) }),
          per_page: limit,
          sort: "updated",
          state: input.state ?? "open",
        });
        const rawIssues = array(response.data);
        let truncated = hasNextPage(response.headers) || rawIssues.length > limit;
        const issues = rawIssues
          .filter((entry) => !object(entry)?.pull_request)
          .slice(0, limit)
          .map((entry) => {
            const normalized = normalizeIssueSummary(entry, input);
            truncated ||= normalized.truncated;
            return normalized.value;
          });
        return githubBacklogListOutputSchema.parse({
          fetchedAt: now().toISOString(),
          issues,
          provenance,
          repositoryFullName: repositoryFullName(input),
          truncated,
        });
      } catch (error) {
        return providerFailure(error);
      }
    },

    async readBacklogItem(input) {
      try {
        const client = await getInstallationClient(input.installationId);
        const base = {
          ...requestParameters(input),
          issue_number: input.issueNumber,
        };
        const issueRequest = client.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}",
          base,
        );
        const commentsRequest =
          input.commentLimit === 0
            ? Promise.resolve({ data: [], headers: {} })
            : client.request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
                ...base,
                per_page: Math.min(20, input.commentLimit),
              });
        const parentRequest = client
          .request("GET /repos/{owner}/{repo}/issues/{issue_number}/parent", base)
          .catch((error: unknown) => {
            if (isNotFound(error)) return { data: null, headers: {} };
            throw error;
          });
        const subIssuesRequest = client.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
          { ...base, per_page: maxRelationshipCount },
        );
        const blockedByRequest = client.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
          { ...base, per_page: maxRelationshipCount },
        );
        const blockingRequest = client.request(
          "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking",
          { ...base, per_page: maxRelationshipCount },
        );
        const [issueResponse, commentsResponse, parentResponse, subIssues, blockedBy, blocking] =
          await Promise.all([
            issueRequest,
            commentsRequest,
            parentRequest,
            subIssuesRequest,
            blockedByRequest,
            blockingRequest,
          ]);
        const issueData = object(issueResponse.data);
        if (!issueData) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
        const issue = normalizeIssueSummary(issueData, input);
        const body = sanitizeText(nullableString(issueData.body) ?? "", maxIssueBodyLength);
        const rawComments = array(commentsResponse.data);
        let commentsTruncated =
          hasNextPage(commentsResponse.headers) ||
          rawComments.length > input.commentLimit ||
          issue.value.commentCount > rawComments.length;
        const comments = rawComments.slice(0, Math.min(20, input.commentLimit)).map((value) => {
          const data = object(value);
          if (!data) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
          const id = positiveInteger(data.id);
          const commentBody = sanitizeText(nullableString(data.body) ?? "", maxCommentBodyLength);
          const authorAssociation =
            data.author_association === null || data.author_association === undefined
              ? null
              : sanitizeText(requiredString(data.author_association), 64);
          const authorLogin = normalizeLogin(data.user);
          commentsTruncated ||=
            commentBody.truncated || authorAssociation?.truncated === true || authorLogin.truncated;
          return githubBacklogCommentSchema.parse({
            authorAssociation: authorAssociation?.value ?? null,
            authorLogin: authorLogin.value,
            body: commentBody.value,
            createdAt: timestamp(data.created_at),
            id,
            updatedAt: timestamp(data.updated_at),
            url: `https://github.com/${input.owner}/${input.repo}/issues/${input.issueNumber}#issuecomment-${id}`,
          });
        });
        const normalizeRelationship = (response: GithubRequestResponse) => {
          const rawValues = array(response.data);
          let fieldTruncated =
            hasNextPage(response.headers) || rawValues.length > maxRelationshipCount;
          const values = rawValues.slice(0, maxRelationshipCount).map((entry) => {
            const normalized = normalizeIssueSummary(entry, input);
            fieldTruncated ||= normalized.truncated;
            return normalized.value;
          });
          return { truncated: fieldTruncated, values };
        };
        const subIssueValues = normalizeRelationship(subIssues);
        const blockedByValues = normalizeRelationship(blockedBy);
        const blockingValues = normalizeRelationship(blocking);
        const parent =
          parentResponse.data === null
            ? { truncated: false, value: null }
            : normalizeIssueSummary(parentResponse.data, input);
        return githubBacklogItemOutputSchema.parse({
          body: body.value,
          comments,
          fetchedAt: now().toISOString(),
          issue: issue.value,
          provenance,
          relationships: {
            blockedBy: blockedByValues.values,
            blocking: blockingValues.values,
            parent: parent.value,
            subIssues: subIssueValues.values,
          },
          repositoryFullName: repositoryFullName(input),
          truncation: {
            blockedBy: blockedByValues.truncated,
            blocking: blockingValues.truncated,
            body: body.truncated,
            comments: commentsTruncated,
            issue: issue.truncated,
            parent: parent.truncated,
            subIssues: subIssueValues.truncated,
          },
        });
      } catch (error) {
        return providerFailure(error);
      }
    },

    async listTaxonomy(input) {
      try {
        const client = await getInstallationClient(input.installationId);
        const [labelsResponse, milestonesResponse] = await Promise.all([
          client.request("GET /repos/{owner}/{repo}/labels", {
            ...requestParameters(input),
            per_page: maxLabels,
          }),
          client.request("GET /repos/{owner}/{repo}/milestones", {
            ...requestParameters(input),
            direction: "asc",
            per_page: maxMilestones,
            sort: "due_on",
            state: "all",
          }),
        ]);
        const rawLabels = array(labelsResponse.data);
        let labelsTruncated = hasNextPage(labelsResponse.headers) || rawLabels.length > maxLabels;
        const labels = rawLabels.slice(0, maxLabels).map((value) => {
          const data = object(value);
          if (!data) throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
          const name = sanitizeText(requiredString(data.name), 100);
          const description =
            data.description === null || data.description === undefined
              ? null
              : sanitizeText(requiredString(data.description), 500);
          labelsTruncated ||= name.truncated || description?.truncated === true;
          return githubBacklogLabelSchema.parse({
            description: description?.value ?? null,
            name: name.value,
          });
        });
        const rawMilestones = array(milestonesResponse.data);
        let milestonesTruncated =
          hasNextPage(milestonesResponse.headers) || rawMilestones.length > maxMilestones;
        const milestones = rawMilestones.slice(0, maxMilestones).map((value) => {
          const data = object(value);
          if (!data || (data.state !== "open" && data.state !== "closed")) {
            throw new GithubPlanningBacklogError("github_backlog_payload_invalid");
          }
          const title = sanitizeText(requiredString(data.title), 500);
          const description =
            data.description === null || data.description === undefined
              ? null
              : sanitizeText(requiredString(data.description), 2_000);
          milestonesTruncated ||= title.truncated || description?.truncated === true;
          return githubBacklogTaxonomyMilestoneSchema.parse({
            closedIssues: nonnegativeInteger(data.closed_issues),
            description: description?.value ?? null,
            dueOn: nullableTimestamp(data.due_on),
            number: positiveInteger(data.number),
            openIssues: nonnegativeInteger(data.open_issues),
            state: data.state,
            title: title.value,
          });
        });
        return githubBacklogTaxonomyOutputSchema.parse({
          fetchedAt: now().toISOString(),
          labels,
          milestones,
          provenance,
          repositoryFullName: repositoryFullName(input),
          truncation: {
            labels: labelsTruncated,
            milestones: milestonesTruncated,
          },
        });
      } catch (error) {
        return providerFailure(error);
      }
    },
  };
}
