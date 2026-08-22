export function assertExclusivePreviewAliasLease(input: {
  holders: readonly number[];
  pullRequest: number;
}): void {
  const holders = [...new Set(input.holders)].sort((left, right) => left - right);
  if (holders.length !== 1 || holders[0] !== input.pullRequest) {
    throw new Error(
      `preview:alias is exclusively leased by open pull request(s): ${holders.join(", ") || "none"}. ` +
        `Pull request #${input.pullRequest} must be the only holder before alias-bound validation.`,
    );
  }
}

type GithubFetch = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

function parseRepository(value: string): { owner: string; repository: string } {
  const [owner, repository, extra] = value.split("/");
  if (!owner || !repository || extra)
    throw new Error("--repository must be an owner/repository name.");
  return { owner, repository };
}

function parseNextPage(value: string | null): URL | undefined {
  const match = value && /<([^>]+)>;\s*rel="next"/.exec(value);
  if (!match?.[1]) return undefined;
  const next = new URL(match[1]);
  if (next.origin !== "https://api.github.com") {
    throw new Error("GitHub alias lease check returned an unsafe pagination URL.");
  }
  return next;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "loopworks-preview-alias-lease",
  };
}

/** Rechecks the live GitHub lease immediately before an alias mutation. */
export async function assertLiveExclusivePreviewAliasLease(
  input: { expectedCommitSha: string; pullRequest: number; repository: string; token: string },
  dependencies: { fetchGithub?: GithubFetch } = {},
): Promise<void> {
  if (!Number.isSafeInteger(input.pullRequest) || input.pullRequest < 1) {
    throw new Error("pullRequest must be a positive integer.");
  }
  if (!input.token) throw new Error("GitHub token is required to recheck the preview:alias lease.");
  if (!input.expectedCommitSha.trim()) {
    throw new Error("Expected commit SHA is required to recheck the preview:alias lease.");
  }

  const { owner, repository } = parseRepository(input.repository);
  const fetchGithub = dependencies.fetchGithub ?? fetch;
  let url: URL | undefined = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?state=open&per_page=100`,
    "https://api.github.com",
  );
  const holders: number[] = [];
  const visitedUrls = new Set<string>();
  while (url) {
    if (visitedUrls.has(url.toString())) {
      throw new Error("GitHub alias lease check returned cyclic holder pagination.");
    }
    visitedUrls.add(url.toString());
    const response = await fetchGithub(url, { headers: githubHeaders(input.token) });
    if (!response.ok) throw new Error(`GitHub alias lease check failed (${response.status}).`);
    const body: unknown = await response.json();
    if (!Array.isArray(body))
      throw new Error("GitHub alias lease check returned malformed open PRs.");
    for (const pullRequest of body) {
      if (typeof pullRequest !== "object" || pullRequest === null) {
        throw new Error("GitHub alias lease check returned malformed open PRs.");
      }
      const { labels, number } = pullRequest as { labels?: unknown; number?: unknown };
      if (
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        !Array.isArray(labels)
      ) {
        throw new Error("GitHub alias lease check returned malformed open PRs.");
      }
      for (const label of labels) {
        if (
          typeof label !== "object" ||
          label === null ||
          typeof (label as { name?: unknown }).name !== "string" ||
          !(label as { name: string }).name.trim()
        ) {
          throw new Error("GitHub alias lease check returned malformed open PRs.");
        }
      }
      if (labels.some((label) => (label as { name: string }).name === "preview:alias")) {
        holders.push(number);
      }
    }
    url = parseNextPage(response.headers.get("link"));
  }
  assertExclusivePreviewAliasLease({ holders, pullRequest: input.pullRequest });

  // Keep the exact-head assertion as the final network operation before POST.
  const pullRequestUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls/${input.pullRequest}`,
    "https://api.github.com",
  );
  const pullRequestResponse = await fetchGithub(pullRequestUrl, {
    headers: githubHeaders(input.token),
  });
  if (!pullRequestResponse.ok) {
    throw new Error(`GitHub alias lease check failed (${pullRequestResponse.status}).`);
  }
  const pullRequest: unknown = await pullRequestResponse.json();
  const state =
    typeof pullRequest === "object" && pullRequest !== null
      ? (pullRequest as { state?: unknown }).state
      : undefined;
  if (state !== "open") {
    throw new Error("GitHub alias lease check found that the selected pull request is not open.");
  }
  const headSha =
    typeof pullRequest === "object" &&
    pullRequest !== null &&
    typeof (pullRequest as { head?: { sha?: unknown } }).head?.sha === "string"
      ? (pullRequest as { head: { sha: string } }).head.sha
      : undefined;
  if (!headSha) throw new Error("GitHub alias lease check returned a malformed pull request head.");
  if (headSha !== input.expectedCommitSha) {
    throw new Error("GitHub alias lease head does not match the selected commit.");
  }
  const labels =
    typeof pullRequest === "object" && pullRequest !== null
      ? (pullRequest as { labels?: unknown }).labels
      : undefined;
  if (!Array.isArray(labels)) {
    throw new Error("GitHub alias lease check returned malformed pull request labels.");
  }
  if (
    labels.some(
      (label) =>
        typeof label !== "object" ||
        label === null ||
        typeof (label as { name?: unknown }).name !== "string" ||
        !(label as { name: string }).name.trim(),
    )
  ) {
    throw new Error("GitHub alias lease check returned malformed pull request labels.");
  }
  if (!labels.some((label) => (label as { name: string }).name === "preview:alias")) {
    throw new Error(
      "GitHub alias lease check found that this pull request no longer has preview:alias.",
    );
  }
}

function flagValue(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    const pullRequest = Number(flagValue(argv, "--pull-request"));
    const holders = flagValue(argv, "--holders")
      .split(",")
      .filter(Boolean)
      .map((value) => Number(value));
    if (
      !Number.isSafeInteger(pullRequest) ||
      pullRequest < 1 ||
      holders.some((holder) => !Number.isSafeInteger(holder) || holder < 1)
    ) {
      throw new Error(
        "--pull-request and --holders must contain positive integer pull request numbers.",
      );
    }
    assertExclusivePreviewAliasLease({ holders, pullRequest });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
