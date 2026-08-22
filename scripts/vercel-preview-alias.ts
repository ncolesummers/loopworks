import { readFile } from "node:fs/promises";

import { readSuppliedStringConfig } from "@/lib/config/registry";
import { assertLiveExclusivePreviewAliasLease } from "./assert-preview-alias-lease";

export type VercelDeploymentSummary = {
  uid: string;
  url: string;
  created: number;
  /** The v6 listing returns `readyState`; some responses carry `state`. */
  readyState?: string;
  state?: string;
  /** `null` for preview deployments, `"production"` for production ones. */
  target?: string | null;
  meta?: Record<string, unknown>;
};

export type VercelProjectLink = { projectId: string; orgId: string };

type VercelApiRequest = { token: string; projectId: string; orgId: string };

const deploymentsEndpoint = "https://api.vercel.com/v6/deployments";

export function readVercelProjectLink(content: string): VercelProjectLink {
  const parsed: unknown = JSON.parse(content);
  const project =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { projects?: unknown[] }).projects)
      ? ((parsed as { projects: unknown[] }).projects[0] as
          | { id?: string; orgId?: string }
          | undefined)
      : undefined;

  if (!project?.id || !project.orgId) {
    throw new Error("Repository is not linked to a Vercel project; run 'vercel link' first.");
  }
  return { projectId: project.id, orgId: project.orgId };
}

/**
 * `.vercel/` is gitignored, so the linked-project file exists locally but never
 * in a CI checkout. CI passes the identifiers explicitly instead.
 */
export function resolveVercelProjectLink(input: {
  projectId?: string;
  orgId?: string;
  repoJson?: string;
}): VercelProjectLink {
  if (input.projectId && input.orgId) {
    return { projectId: input.projectId, orgId: input.orgId };
  }
  if (input.repoJson) return readVercelProjectLink(input.repoJson);
  throw new Error(
    "Pass --project-id and --org-id, or run from a repository linked with 'vercel link'.",
  );
}

/**
 * The alias must be a bare hostname. Rejecting a scheme or path here keeps a
 * malformed repository variable from becoming a surprising alias assignment.
 */
export function parseAliasHost(value: string): string {
  const host = value.trim();
  if (!host || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) {
    throw new Error(`Preview alias must be a bare hostname, received: ${JSON.stringify(value)}`);
  }
  return host;
}

function isReady(deployment: VercelDeploymentSummary): boolean {
  return (deployment.readyState ?? deployment.state) === "READY";
}

function canonicalPullRequestId(value: unknown): string | undefined {
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return undefined;
}

/**
 * Picks the newest READY preview deployment built from `commitSha`. Production
 * deployments are excluded outright so a misfiring workflow can never repoint
 * the alias at production.
 */
export function selectPreviewDeployment(
  deployments: readonly VercelDeploymentSummary[],
  input: { commitSha: string; pullRequestId: string },
): VercelDeploymentSummary | undefined {
  return deployments
    .filter(
      (deployment) =>
        deployment.target !== "production" &&
        isReady(deployment) &&
        typeof deployment.meta?.githubCommitSha === "string" &&
        deployment.meta.githubCommitSha === input.commitSha &&
        canonicalPullRequestId(deployment.meta.githubPrId) === input.pullRequestId,
    )
    .reduce<VercelDeploymentSummary | undefined>(
      (newest, deployment) =>
        !newest || deployment.created > newest.created ? deployment : newest,
      undefined,
    );
}

async function requestVercel(url: URL, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    // The status and endpoint are enough to diagnose; the token never appears.
    throw new Error(`Vercel API ${url.pathname} responded ${response.status}.`);
  }
  return response.json();
}

export async function fetchProjectDeployments(
  request: VercelApiRequest,
): Promise<VercelDeploymentSummary[]> {
  const deployments: VercelDeploymentSummary[] = [];
  const visitedCursors = new Set<number>();
  let until: number | undefined;
  do {
    const url = new URL(deploymentsEndpoint);
    url.searchParams.set("projectId", request.projectId);
    url.searchParams.set("teamId", request.orgId);
    url.searchParams.set("target", "preview");
    url.searchParams.set("limit", "100");
    if (until !== undefined) url.searchParams.set("until", String(until));
    const body = await requestVercel(url, request.token);
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { deployments?: unknown }).deployments)
    ) {
      throw new Error("Vercel deployment listing returned malformed deployments.");
    }
    deployments.push(...(body as { deployments: VercelDeploymentSummary[] }).deployments);
    const pagination = (body as { pagination?: unknown }).pagination;
    if (pagination === undefined) return deployments;
    if (typeof pagination !== "object" || pagination === null || !("next" in pagination)) {
      throw new Error("Vercel deployment listing returned malformed pagination.");
    }
    const next = (pagination as { next?: unknown }).next;
    if (next === null) return deployments;
    if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 0) {
      throw new Error("Vercel deployment listing returned malformed pagination cursor.");
    }
    if (visitedCursors.has(next))
      throw new Error("Vercel deployment listing returned cyclic pagination.");
    visitedCursors.add(next);
    until = next;
  } while (until !== undefined);
  return deployments;
}

export async function assignDeploymentAlias(input: {
  token: string;
  orgId: string;
  deploymentId: string;
  alias: string;
}): Promise<void> {
  const url = new URL(`https://api.vercel.com/v2/deployments/${input.deploymentId}/aliases`);
  url.searchParams.set("teamId", input.orgId);
  await requestVercel(url, input.token, {
    method: "POST",
    body: JSON.stringify({ alias: parseAliasHost(input.alias) }),
  });
}

/**
 * The lease is rechecked only after a deployment is READY, directly before the
 * mutation. Checking before the READY wait leaves a race where another pull
 * request can acquire `preview:alias` while Vercel finishes the build.
 */
export async function assignReadyPreviewAlias(
  input: {
    alias: string;
    commitSha: string;
    pullRequestId: string;
    link: VercelProjectLink;
    token: string;
  },
  dependencies: {
    assertLease: () => Promise<void>;
    assignAlias: (input: {
      alias: string;
      deploymentId: string;
      orgId: string;
      token: string;
    }) => Promise<void>;
    fetchDeployments: (request: VercelApiRequest) => Promise<VercelDeploymentSummary[]>;
  },
): Promise<boolean> {
  const deployments = await dependencies.fetchDeployments({ ...input.link, token: input.token });
  const deployment = selectPreviewDeployment(deployments, {
    commitSha: input.commitSha,
    pullRequestId: input.pullRequestId,
  });
  if (!deployment) return false;

  await dependencies.assertLease();
  await dependencies.assignAlias({
    alias: input.alias,
    deploymentId: deployment.uid,
    orgId: input.link.orgId,
    token: input.token,
  });
  return true;
}

export function previewAliasComment(input: { alias: string; commitSha: string }): string {
  return [
    `**Preview alias updated** → https://${input.alias}`,
    "",
    `Now serving \`${input.commitSha.slice(0, 7)}\`. This is the stable origin registered as the`,
    "preview GitHub App's callback and Setup URL, so the installation and repository-selection",
    "flows work here and nowhere else in preview.",
    "",
    "Vercel Authentication still guards it — sign in with the authorized account first.",
  ].join("\n");
}

async function main(argv: readonly string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const commitSha = flag("--commit-sha");
  const alias = parseAliasHost(flag("--alias") ?? "");
  const pullRequestId = flag("--pull-request") ?? "";
  const pullRequest = Number(pullRequestId);
  const repository = flag("--repository");
  const timeoutSeconds = Number(flag("--timeout-seconds") ?? "600");
  if (!commitSha) throw new Error("--commit-sha is required.");
  if (!Number.isSafeInteger(pullRequest) || pullRequest < 1) {
    throw new Error("--pull-request must be a positive integer.");
  }
  if (!repository) throw new Error("--repository is required.");
  if (String(pullRequest) !== pullRequestId)
    throw new Error("--pull-request must be a canonical integer.");

  const token = readSuppliedStringConfig("VERCEL_ACCESS_TOKEN", process.env);
  if (!token) throw new Error("VERCEL_ACCESS_TOKEN is required to assign a preview alias.");
  const githubToken = readSuppliedStringConfig("GH_TOKEN", process.env);
  if (!githubToken) throw new Error("GH_TOKEN is required to recheck the preview:alias lease.");

  const link = resolveVercelProjectLink({
    projectId: flag("--project-id"),
    orgId: flag("--org-id"),
    repoJson: await readFile(".vercel/repo.json", "utf8").catch(() => undefined),
  });
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const assigned = await assignReadyPreviewAlias(
      { alias, commitSha, link, pullRequestId, token },
      {
        fetchDeployments: fetchProjectDeployments,
        assertLease: () =>
          assertLiveExclusivePreviewAliasLease({
            expectedCommitSha: commitSha,
            pullRequest,
            repository,
            token: githubToken,
          }),
        assignAlias: assignDeploymentAlias,
      },
    );
    if (assigned) {
      console.log(previewAliasComment({ alias, commitSha }));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }

  throw new Error(
    `No ready preview deployment for ${commitSha} within ${timeoutSeconds}s; the build may have failed.`,
  );
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
