import { createHash } from "node:crypto";

import { App } from "@octokit/app";

export type GitHubFileChange = {
  content: string;
  path: string;
};

export type GitHubPullRequestWriterInput = {
  baseBranch: string;
  body: string;
  changes: GitHubFileChange[];
  commitMessage: string;
  draft: true;
  installationId: number;
  owner: string;
  repo: string;
  runId: string;
  title: string;
};

export type GitHubPullRequestWriteResult = {
  headBranch: string;
  headSha: string;
  number: number;
  url: string;
};

export type GitHubPullRequestWriter = (
  input: GitHubPullRequestWriterInput,
) => Promise<GitHubPullRequestWriteResult>;

type GitHubCommitData = {
  message: string;
  sha: string;
  tree: { sha: string };
};

type GitHubPullRequestData = {
  head: { sha: string };
  html_url: string;
  number: number;
};

export type GitHubPullRequestClient = {
  rest: {
    git: {
      createBlob: (input: {
        content: string;
        encoding: "utf-8";
        owner: string;
        repo: string;
      }) => Promise<{ data: { sha: string } }>;
      createCommit: (input: {
        message: string;
        owner: string;
        parents: string[];
        repo: string;
        tree: string;
      }) => Promise<{ data: { sha: string } }>;
      createRef: (input: {
        owner: string;
        ref: string;
        repo: string;
        sha: string;
      }) => Promise<{ data: { object: { sha: string } } }>;
      createTree: (input: {
        base_tree: string;
        owner: string;
        repo: string;
        tree: Array<{
          mode: "100644";
          path: string;
          sha: string;
          type: "blob";
        }>;
      }) => Promise<{ data: { sha: string } }>;
      getCommit: (input: {
        commit_sha: string;
        owner: string;
        repo: string;
      }) => Promise<{ data: GitHubCommitData }>;
      getRef: (input: {
        owner: string;
        ref: string;
        repo: string;
      }) => Promise<{ data: { object: { sha: string } } }>;
    };
    pulls: {
      create: (input: {
        base: string;
        body: string;
        draft: true;
        head: string;
        owner: string;
        repo: string;
        title: string;
      }) => Promise<{ data: GitHubPullRequestData }>;
      list: (input: {
        base: string;
        head: string;
        owner: string;
        repo: string;
        state: "open";
      }) => Promise<{ data: GitHubPullRequestData[] }>;
    };
  };
};

export class GitHubPullRequestWriteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "GitHubPullRequestWriteError";
  }
}

type GitHubPullRequestWriterDependencies = {
  getInstallationClient?: (installationId: number) => Promise<GitHubPullRequestClient>;
};

function requiredEnvironmentValue(name: "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GitHubPullRequestWriteError(
      `GitHub App configuration is missing ${name}.`,
      "github_app_configuration_missing",
    );
  }
  return value;
}

async function getDefaultInstallationClient(
  installationId: number,
): Promise<GitHubPullRequestClient> {
  const app = new App({
    appId: requiredEnvironmentValue("GITHUB_APP_ID"),
    privateKey: requiredEnvironmentValue("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n"),
  });
  return (await app.getInstallationOctokit(installationId)) as unknown as GitHubPullRequestClient;
}

function validateChanges(changes: GitHubFileChange[]): GitHubFileChange[] {
  if (changes.length === 0) {
    throw new GitHubPullRequestWriteError(
      "At least one file change is required to create a commit.",
      "github_file_changes_empty",
    );
  }

  const paths = new Set<string>();
  const normalized = changes.map((change) => {
    const path = change.path.trim();
    const segments = path.split("/");
    if (
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("\0") ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new GitHubPullRequestWriteError(
        "File changes must use unique repository-relative POSIX paths.",
        "github_file_path_invalid",
      );
    }
    if (paths.has(path)) {
      throw new GitHubPullRequestWriteError(
        "File changes must use unique repository-relative POSIX paths.",
        "github_file_path_duplicate",
      );
    }
    paths.add(path);
    return { content: change.content, path };
  });

  return normalized.sort((left, right) => left.path.localeCompare(right.path));
}

export function createPullRequestChangeDigest(input: {
  changes: GitHubFileChange[];
  commitMessage: string;
}): string {
  const hash = createHash("sha256");
  const commitMessage = input.commitMessage.trim();
  const changes = validateChanges(input.changes);
  hash.update(`commit:${Buffer.byteLength(commitMessage)}:`, "utf8");
  hash.update(commitMessage, "utf8");
  for (const change of changes) {
    hash.update(`\npath:${Buffer.byteLength(change.path)}:`, "utf8");
    hash.update(change.path, "utf8");
    hash.update(`\ncontent:${Buffer.byteLength(change.content)}:`, "utf8");
    hash.update(change.content, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

function isHttpNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

function validateWriterInput(input: GitHubPullRequestWriterInput): GitHubFileChange[] {
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) {
    throw new GitHubPullRequestWriteError(
      "A positive GitHub App installation id is required.",
      "github_installation_invalid",
    );
  }
  for (const [name, value] of [
    ["owner", input.owner],
    ["repo", input.repo],
    ["baseBranch", input.baseBranch],
    ["runId", input.runId],
    ["title", input.title],
    ["body", input.body],
    ["commitMessage", input.commitMessage],
  ] as const) {
    if (!value.trim()) {
      throw new GitHubPullRequestWriteError(
        `${name} is required for GitHub PR creation.`,
        "github_pr_input_invalid",
      );
    }
  }
  return validateChanges(input.changes);
}

function resultFromPullRequest(
  pullRequest: GitHubPullRequestData,
  headBranch: string,
): GitHubPullRequestWriteResult {
  return {
    headBranch,
    headSha: pullRequest.head.sha,
    number: pullRequest.number,
    url: pullRequest.html_url,
  };
}

export function createGitHubPullRequestWriter(
  dependencies: GitHubPullRequestWriterDependencies = {},
): GitHubPullRequestWriter {
  const getInstallationClient = dependencies.getInstallationClient ?? getDefaultInstallationClient;

  return async (input) => {
    const changes = validateWriterInput(input);
    const changeDigest = createPullRequestChangeDigest({
      changes,
      commitMessage: input.commitMessage,
    });
    const client = await getInstallationClient(input.installationId);
    const headBranch = `loopworks/run-${input.runId}`;
    const runMarker = `[loopworks-run:${input.runId}]`;
    const changeMarker = `[loopworks-change:${changeDigest}]`;
    const pullRequestQuery = {
      base: input.baseBranch,
      head: `${input.owner}:${headBranch}`,
      owner: input.owner,
      repo: input.repo,
      state: "open" as const,
    };
    let existingHeadSha: string | undefined;
    try {
      const existingHead = await client.rest.git.getRef({
        owner: input.owner,
        ref: `heads/${headBranch}`,
        repo: input.repo,
      });
      existingHeadSha = existingHead.data.object.sha;
      const existingCommit = await client.rest.git.getCommit({
        commit_sha: existingHeadSha,
        owner: input.owner,
        repo: input.repo,
      });
      const commitTrailers = existingCommit.data.message.trimEnd().split("\n").slice(-2);
      if (commitTrailers[0] !== runMarker || commitTrailers[1] !== changeMarker) {
        throw new GitHubPullRequestWriteError(
          "The deterministic PR branch exists but is not owned by this run.",
          "github_pr_branch_conflict",
        );
      }
    } catch (error) {
      if (!isHttpNotFound(error)) {
        throw error;
      }
    }

    const existingPullRequests = await client.rest.pulls.list(pullRequestQuery);
    if (existingPullRequests.data[0]) {
      if (!existingHeadSha || existingPullRequests.data[0].head.sha !== existingHeadSha) {
        throw new GitHubPullRequestWriteError(
          "The existing pull request does not match this run's verified branch.",
          "github_pr_reconciliation_mismatch",
        );
      }
      return resultFromPullRequest(existingPullRequests.data[0], headBranch);
    }

    let headSha = existingHeadSha;
    if (!headSha) {
      const baseRef = await client.rest.git.getRef({
        owner: input.owner,
        ref: `heads/${input.baseBranch}`,
        repo: input.repo,
      });
      const baseSha = baseRef.data.object.sha;
      const baseCommit = await client.rest.git.getCommit({
        commit_sha: baseSha,
        owner: input.owner,
        repo: input.repo,
      });
      const treeEntries: Array<{
        mode: "100644";
        path: string;
        sha: string;
        type: "blob";
      }> = [];
      for (const change of changes) {
        const blob = await client.rest.git.createBlob({
          content: change.content,
          encoding: "utf-8",
          owner: input.owner,
          repo: input.repo,
        });
        treeEntries.push({
          mode: "100644",
          path: change.path,
          sha: blob.data.sha,
          type: "blob",
        });
      }
      const tree = await client.rest.git.createTree({
        base_tree: baseCommit.data.tree.sha,
        owner: input.owner,
        repo: input.repo,
        tree: treeEntries,
      });
      const commit = await client.rest.git.createCommit({
        message: `${input.commitMessage.trim()}\n\n${runMarker}\n${changeMarker}`,
        owner: input.owner,
        parents: [baseSha],
        repo: input.repo,
        tree: tree.data.sha,
      });
      headSha = commit.data.sha;
      await client.rest.git.createRef({
        owner: input.owner,
        ref: `refs/heads/${headBranch}`,
        repo: input.repo,
        sha: headSha,
      });
    }

    try {
      const created = await client.rest.pulls.create({
        base: input.baseBranch,
        body: input.body,
        draft: true,
        head: headBranch,
        owner: input.owner,
        repo: input.repo,
        title: input.title,
      });
      return resultFromPullRequest(created.data, headBranch);
    } catch (_error) {
      const reconciled = await client.rest.pulls.list(pullRequestQuery);
      if (reconciled.data[0]) {
        return resultFromPullRequest(reconciled.data[0], headBranch);
      }
      throw new GitHubPullRequestWriteError(
        "GitHub did not confirm draft pull request creation.",
        "github_pr_creation_failed",
      );
    }
  };
}

export const createGitHubPullRequest = createGitHubPullRequestWriter();
