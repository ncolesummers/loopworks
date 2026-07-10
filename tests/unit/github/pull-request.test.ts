/** @vitest-environment node */
import {
  createPullRequestChangeDigest,
  createGitHubPullRequestWriter,
  GitHubPullRequestWriteError,
  type GitHubPullRequestClient,
  type GitHubPullRequestWriterInput,
} from "@/lib/github/pull-request";

const input: GitHubPullRequestWriterInput = {
  baseBranch: "main",
  body: "## Summary\n\nDeterministic PR intent.",
  changes: [
    { content: "export const ready = true;\n", path: "src/ready.ts" },
    { content: "# Evidence\n", path: "docs/evidence.md" },
  ],
  commitMessage: "feat: add guarded PR path",
  draft: true,
  installationId: 15_001,
  owner: "ncolesummers",
  repo: "loopworks",
  runId: "15000000-0000-4000-8000-000000000001",
  title: "Issue #15: PR creation path",
};
const inputChangeDigest = createPullRequestChangeDigest({
  changes: input.changes,
  commitMessage: input.commitMessage,
});

function notFoundError(): Error & { status: number } {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

function createClient(): GitHubPullRequestClient {
  return {
    rest: {
      git: {
        createBlob: vi.fn().mockImplementation(({ content }: { content: string }) =>
          Promise.resolve({
            data: { sha: content.includes("Evidence") ? "blob-docs" : "blob-ready" },
          }),
        ),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: "commit-sha" } }),
        createRef: vi.fn().mockResolvedValue({ data: { object: { sha: "commit-sha" } } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: "tree-sha" } }),
        getCommit: vi.fn().mockResolvedValue({
          data: { message: "base commit", sha: "base-sha", tree: { sha: "base-tree" } },
        }),
        getRef: vi
          .fn()
          .mockRejectedValueOnce(notFoundError())
          .mockResolvedValueOnce({ data: { object: { sha: "base-sha" } } }),
      },
      pulls: {
        create: vi.fn().mockResolvedValue({
          data: {
            head: { sha: "commit-sha" },
            html_url: "https://github.com/ncolesummers/loopworks/pull/115",
            number: 115,
          },
        }),
        list: vi.fn().mockResolvedValue({ data: [] }),
      },
    },
  };
}

describe("GitHub pull request writer", () => {
  it("computes a stable digest over the commit message and sorted file bytes", () => {
    const forward = createPullRequestChangeDigest({
      changes: input.changes,
      commitMessage: input.commitMessage,
    });
    const reversed = createPullRequestChangeDigest({
      changes: [...input.changes].reverse(),
      commitMessage: input.commitMessage,
    });

    expect(forward).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(reversed).toBe(forward);
    expect(
      createPullRequestChangeDigest({
        changes: input.changes,
        commitMessage: `${input.commitMessage}!`,
      }),
    ).not.toBe(forward);
  });

  it("creates blobs, a tree, a marked commit, a deterministic branch, and a draft PR", async () => {
    const client = createClient();
    const getInstallationClient = vi.fn().mockResolvedValue(client);
    const writer = createGitHubPullRequestWriter({ getInstallationClient });

    await expect(writer(input)).resolves.toEqual({
      headBranch: `loopworks/run-${input.runId}`,
      headSha: "commit-sha",
      number: 115,
      url: "https://github.com/ncolesummers/loopworks/pull/115",
    });

    expect(getInstallationClient).toHaveBeenCalledWith(15_001);
    expect(client.rest.git.createTree).toHaveBeenCalledWith({
      base_tree: "base-tree",
      owner: "ncolesummers",
      repo: "loopworks",
      tree: [
        { mode: "100644", path: "docs/evidence.md", sha: "blob-docs", type: "blob" },
        { mode: "100644", path: "src/ready.ts", sha: "blob-ready", type: "blob" },
      ],
    });
    expect(client.rest.git.createCommit).toHaveBeenCalledWith({
      message: `feat: add guarded PR path\n\n[loopworks-run:15000000-0000-4000-8000-000000000001]\n[loopworks-change:${inputChangeDigest}]`,
      owner: "ncolesummers",
      parents: ["base-sha"],
      repo: "loopworks",
      tree: "tree-sha",
    });
    expect(client.rest.git.createRef).toHaveBeenCalledWith({
      owner: "ncolesummers",
      ref: `refs/heads/loopworks/run-${input.runId}`,
      repo: "loopworks",
      sha: "commit-sha",
    });
    expect(client.rest.pulls.create).toHaveBeenCalledWith({
      base: "main",
      body: input.body,
      draft: true,
      head: `loopworks/run-${input.runId}`,
      owner: "ncolesummers",
      repo: "loopworks",
      title: input.title,
    });
  });

  it("returns an existing open PR without creating Git objects", async () => {
    const client = createClient();
    (client.rest.git.getRef as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
      data: { object: { sha: "existing-sha" } },
    });
    (client.rest.git.getCommit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        message: `feat: add guarded PR path\n\n[loopworks-run:15000000-0000-4000-8000-000000000001]\n[loopworks-change:${inputChangeDigest}]`,
        sha: "existing-sha",
        tree: { sha: "existing-tree" },
      },
    });
    (client.rest.pulls.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [
        {
          head: { sha: "existing-sha" },
          html_url: "https://github.com/ncolesummers/loopworks/pull/115",
          number: 115,
        },
      ],
    });
    const writer = createGitHubPullRequestWriter({
      getInstallationClient: vi.fn().mockResolvedValue(client),
    });

    await expect(writer(input)).resolves.toMatchObject({
      headSha: "existing-sha",
      number: 115,
    });
    expect(client.rest.git.getRef).toHaveBeenCalledTimes(1);
    expect(client.rest.git.createCommit).not.toHaveBeenCalled();
    expect(client.rest.pulls.create).not.toHaveBeenCalled();
  });

  it("reconciles a marked branch after a prior PR request failed", async () => {
    const client = createClient();
    (client.rest.git.getRef as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
      data: { object: { sha: "existing-commit" } },
    });
    (client.rest.git.getCommit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        message: `feat: add guarded PR path\n\n[loopworks-run:15000000-0000-4000-8000-000000000001]\n[loopworks-change:${inputChangeDigest}]`,
        sha: "existing-commit",
        tree: { sha: "existing-tree" },
      },
    });
    (client.rest.pulls.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        head: { sha: "existing-commit" },
        html_url: "https://github.com/ncolesummers/loopworks/pull/115",
        number: 115,
      },
    });
    const writer = createGitHubPullRequestWriter({
      getInstallationClient: vi.fn().mockResolvedValue(client),
    });

    await expect(writer(input)).resolves.toMatchObject({ headSha: "existing-commit" });
    expect(client.rest.git.createBlob).not.toHaveBeenCalled();
    expect(client.rest.git.createCommit).not.toHaveBeenCalled();
    expect(client.rest.git.createRef).not.toHaveBeenCalled();
    expect(client.rest.pulls.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    { changes: [{ content: "bad", path: "../outside.ts" }] },
    { changes: [{ content: "bad", path: "/absolute.ts" }] },
    {
      changes: [
        { content: "one", path: "src/duplicate.ts" },
        { content: "two", path: "src/duplicate.ts" },
      ],
    },
    { changes: [] },
  ])("rejects unsafe or empty file changes before requesting a client", async ({ changes }) => {
    const getInstallationClient = vi.fn();
    const writer = createGitHubPullRequestWriter({ getInstallationClient });

    await expect(writer({ ...input, changes })).rejects.toBeInstanceOf(GitHubPullRequestWriteError);
    expect(getInstallationClient).not.toHaveBeenCalled();
  });

  it("refuses to reuse a deterministic branch owned by another run", async () => {
    const client = createClient();
    (client.rest.git.getRef as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
      data: { object: { sha: "foreign-commit" } },
    });
    (client.rest.git.getCommit as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { message: "unrelated commit", sha: "foreign-commit", tree: { sha: "tree" } },
    });
    const writer = createGitHubPullRequestWriter({
      getInstallationClient: vi.fn().mockResolvedValue(client),
    });

    await expect(writer(input)).rejects.toThrow(
      "The deterministic PR branch exists but is not owned by this run.",
    );
    expect(client.rest.pulls.create).not.toHaveBeenCalled();
  });
});
