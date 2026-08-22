type PreviewMigrationEnvironment = Readonly<Record<string, string | undefined>>;

type GithubFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

type PullRequest = {
  changedFiles: number;
  headSha: string;
  labels: string[];
};

type OpenPullRequest = { headSha: string; labels: string[]; number: number };

export type PreviewMigrationLeaseResult =
  | { status: "admitted" }
  | { status: "non_database_preview" }
  | { status: "not_preview" }
  | { status: "unassociated_preview" };

const previewAliasLabel = "preview:alias";
const githubApiOrigin = "https://api.github.com";
const maximumGitHubPullRequestFiles = 3_000;

function isPreview(environment: PreviewMigrationEnvironment): boolean {
  return environment.VERCEL_ENV?.trim().toLowerCase() === "preview";
}

function requiredValue(environment: PreviewMigrationEnvironment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Preview migration lease requires ${name}.`);
  return value;
}

function pullRequestNumber(environment: PreviewMigrationEnvironment): number {
  const value = requiredValue(environment, "VERCEL_GIT_PULL_REQUEST_ID");
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("Preview migration lease requires a positive VERCEL_GIT_PULL_REQUEST_ID.");
  }
  return Number(value);
}

function githubApiUrl(path: string): URL {
  return new URL(path, githubApiOrigin);
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "loopworks-preview-migration-lease",
  };
}

async function readJson(fetchGithub: GithubFetch, url: URL, token: string): Promise<unknown> {
  const response = await fetchGithub(url, {
    headers: githubHeaders(token),
  });
  if (!response.ok) {
    throw new Error(`GitHub Preview migration lease check failed (${response.status}).`);
  }
  return response.json();
}

function labelNames(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`GitHub Preview migration lease returned malformed ${context} labels.`);
  }
  return value.map((label) => {
    if (
      typeof label !== "object" ||
      label === null ||
      typeof (label as { name?: unknown }).name !== "string" ||
      !(label as { name: string }).name.trim()
    ) {
      throw new Error(`GitHub Preview migration lease returned malformed ${context} labels.`);
    }
    return (label as { name: string }).name;
  });
}

function parseCurrentPullRequest(value: unknown): PullRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("GitHub Preview migration lease returned a malformed pull request.");
  }
  const pullRequest = value as {
    changed_files?: unknown;
    head?: { sha?: unknown };
    labels?: unknown;
  };
  if (
    typeof pullRequest.changed_files !== "number" ||
    !Number.isSafeInteger(pullRequest.changed_files) ||
    pullRequest.changed_files < 0 ||
    typeof pullRequest.head?.sha !== "string" ||
    !pullRequest.head.sha.trim()
  ) {
    throw new Error("GitHub Preview migration lease returned a malformed pull request.");
  }
  return {
    changedFiles: pullRequest.changed_files,
    headSha: pullRequest.head.sha,
    labels: labelNames(pullRequest.labels, "pull request"),
  };
}

function parseOpenPullRequest(value: unknown): OpenPullRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("GitHub Preview migration lease returned malformed open PRs.");
  }
  const pullRequest = value as { head?: { sha?: unknown }; labels?: unknown; number?: unknown };
  if (
    typeof pullRequest.number !== "number" ||
    !Number.isSafeInteger(pullRequest.number) ||
    pullRequest.number < 1
  ) {
    throw new Error("GitHub Preview migration lease returned malformed open PRs.");
  }
  if (typeof pullRequest.head?.sha !== "string" || !pullRequest.head.sha.trim()) {
    throw new Error("GitHub Preview migration lease returned malformed open PRs.");
  }
  return {
    headSha: pullRequest.head.sha,
    labels: labelNames(pullRequest.labels, "open pull request"),
    number: pullRequest.number,
  };
}

function fileNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("GitHub Preview migration lease returned malformed PR files.");
  }
  return value.flatMap((file) => {
    if (
      typeof file !== "object" ||
      file === null ||
      typeof (file as { filename?: unknown }).filename !== "string" ||
      !(file as { filename: string }).filename.trim()
    ) {
      throw new Error("GitHub Preview migration lease returned malformed PR files.");
    }
    const previousFilename = (file as { previous_filename?: unknown }).previous_filename;
    if (
      previousFilename !== undefined &&
      (typeof previousFilename !== "string" || !previousFilename.trim())
    ) {
      throw new Error("GitHub Preview migration lease returned malformed PR files.");
    }
    return previousFilename === undefined
      ? [(file as { filename: string }).filename]
      : [(file as { filename: string }).filename, previousFilename];
  });
}

function isDatabaseChangingPath(path: string): boolean {
  return (
    path.startsWith("src/") ||
    path.startsWith("agent/") ||
    path.startsWith("scripts/") ||
    path.startsWith("drizzle/") ||
    [
      ".github/workflows/preview-alias.yml",
      "drizzle.config.ts",
      "package.json",
      "bun.lock",
      "vercel.json",
      "next.config.ts",
      "next.config.js",
      "tsconfig.json",
      "tsconfig.build.json",
      "scripts/assert-preview-alias-lease.ts",
      "scripts/assert-preview-migration-lease.ts",
      "scripts/bootstrap-local-database.ts",
      "scripts/migrate-database.ts",
      "scripts/provision-store-identity.ts",
      "scripts/sync-vercel-env.ts",
      "scripts/vercel-preview-alias.ts",
      "src/lib/config/registry.ts",
    ].includes(path)
  );
}

function parseNextPage(value: string | null): URL | undefined {
  if (!value) return undefined;
  const match = /<([^>]+)>;\s*rel="next"/.exec(value);
  if (!match?.[1]) return undefined;
  const next = new URL(match[1]);
  if (next.origin !== githubApiOrigin) {
    throw new Error("GitHub Preview migration lease returned an unsafe pagination URL.");
  }
  return next;
}

async function readOpenAliasHolders(input: {
  fetchGithub: GithubFetch;
  owner: string;
  repository: string;
  token: string;
}): Promise<OpenPullRequest[]> {
  let url: URL | undefined = githubApiUrl(
    `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/pulls?state=open&per_page=100`,
  );
  const pullRequests: OpenPullRequest[] = [];
  const visitedUrls = new Set<string>();
  while (url) {
    if (visitedUrls.has(url.toString())) {
      throw new Error("GitHub Preview migration lease returned cyclic holder pagination.");
    }
    visitedUrls.add(url.toString());
    const response = await input.fetchGithub(url, { headers: githubHeaders(input.token) });
    if (!response.ok) {
      throw new Error(`GitHub Preview migration lease check failed (${response.status}).`);
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new Error("GitHub Preview migration lease returned malformed open PRs.");
    }
    pullRequests.push(...body.map(parseOpenPullRequest));
    url = parseNextPage(response.headers.get("link"));
  }
  return pullRequests;
}

async function readChangedFiles(input: {
  changedFiles: number;
  fetchGithub: GithubFetch;
  token: string;
  url: URL;
}): Promise<string[]> {
  if (input.changedFiles >= maximumGitHubPullRequestFiles) {
    throw new Error("GitHub Preview migration lease cannot safely classify a capped pull request.");
  }
  let url: URL | undefined = input.url;
  const names: string[] = [];
  let returnedFiles = 0;
  const visitedUrls = new Set<string>();
  while (url) {
    if (visitedUrls.has(url.toString())) {
      throw new Error("GitHub Preview migration lease returned cyclic file pagination.");
    }
    visitedUrls.add(url.toString());
    const response = await input.fetchGithub(url, { headers: githubHeaders(input.token) });
    if (!response.ok) {
      throw new Error(`GitHub Preview migration lease check failed (${response.status}).`);
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      throw new Error("GitHub Preview migration lease returned malformed PR files.");
    }
    returnedFiles += body.length;
    names.push(...fileNames(body));
    url = parseNextPage(response.headers.get("link"));
  }
  if (returnedFiles !== input.changedFiles) {
    throw new Error("GitHub Preview migration lease received an incomplete PR file list.");
  }
  return names;
}

/**
 * Vercel starts a build before the alias workflow runs. For trusted,
 * non-fork PR code, this admits a database-sensitive Preview migration only
 * when the exact build head owns the sole live `preview:alias` lease. It does
 * not protect against arbitrary code already trusted with Preview credentials.
 * Production and local execution are intentionally no-ops.
 */
export async function assertPreviewMigrationLease(
  environment: PreviewMigrationEnvironment = process.env,
  dependencies: { fetchGithub?: GithubFetch } = {},
): Promise<PreviewMigrationLeaseResult> {
  if (!isPreview(environment)) return { status: "not_preview" };

  if (!environment.VERCEL_GIT_PULL_REQUEST_ID?.trim()) {
    return { status: "unassociated_preview" };
  }

  const owner = requiredValue(environment, "VERCEL_GIT_REPO_OWNER");
  const repository = requiredValue(environment, "VERCEL_GIT_REPO_SLUG");
  const number = pullRequestNumber(environment);
  const commitSha = requiredValue(environment, "VERCEL_GIT_COMMIT_SHA");
  const token = requiredValue(environment, "LOOPWORKS_PREVIEW_GITHUB_TOKEN");
  const fetchGithub = dependencies.fetchGithub ?? fetch;
  const basePath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${number}`;
  const pullRequest = parseCurrentPullRequest(
    await readJson(fetchGithub, githubApiUrl(basePath), token),
  );
  if (pullRequest.headSha !== commitSha) {
    throw new Error(
      "Preview migration lease build commit does not match the live pull request head.",
    );
  }
  const changedFiles = await readChangedFiles({
    changedFiles: pullRequest.changedFiles,
    fetchGithub,
    token,
    url: githubApiUrl(`${basePath}/files?per_page=100`),
  });
  const finalPullRequest = parseCurrentPullRequest(
    await readJson(fetchGithub, githubApiUrl(basePath), token),
  );
  if (
    finalPullRequest.headSha !== commitSha ||
    finalPullRequest.changedFiles !== pullRequest.changedFiles
  ) {
    throw new Error("Preview migration lease changed while its PR files were being classified.");
  }
  if (!changedFiles.some(isDatabaseChangingPath)) return { status: "non_database_preview" };

  const openPullRequests = await readOpenAliasHolders({ fetchGithub, owner, repository, token });
  const holders = openPullRequests.filter((candidate) =>
    candidate.labels.includes(previewAliasLabel),
  );
  const currentPullRequest = openPullRequests.find((candidate) => candidate.number === number);
  if (
    !currentPullRequest ||
    currentPullRequest.headSha !== commitSha ||
    !currentPullRequest.labels.includes(previewAliasLabel) ||
    holders.length !== 1 ||
    holders[0]?.number !== number
  ) {
    throw new Error(
      `Preview migration lease requires this pull request to be the sole open preview:alias holder; found ${holders.map((holder) => holder.number).join(", ") || "none"}.`,
    );
  }
  return { status: "admitted" };
}

if (import.meta.main) {
  assertPreviewMigrationLease().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Preview migration lease check failed.");
    process.exitCode = 1;
  });
}
