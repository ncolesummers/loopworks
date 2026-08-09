/** @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { HttpResponse, http } from "msw";

import {
  fetchPullRequestCommits,
  type GithubCommitProvenance,
  inspectLocalCommitConfiguration,
  isReservedCommitEmail,
  validateGithubCommit,
  validateLocalCommitConfiguration,
} from "../../../scripts/check-commit-provenance";
import { mswServer } from "../../helpers/msw";

const execFileAsync = promisify(execFile);

const actor = (login: string) => ({ login });

const withoutGitEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const cleanEnvironment: NodeJS.ProcessEnv = { ...environment };
  for (const key of Object.keys(cleanEnvironment)) {
    if (key.startsWith("GIT_")) delete cleanEnvironment[key];
  }
  return cleanEnvironment;
};

const configureFixtureRepository = async (
  repository: string,
  inheritedEnvironment: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> => {
  const cleanEnvironment = withoutGitEnvironment(inheritedEnvironment);
  await execFileAsync("git", ["init", "--quiet", repository], {
    env: cleanEnvironment,
  });
  await execFileAsync("git", ["-C", repository, "config", "--local", "user.name", "Alice"], {
    env: cleanEnvironment,
  });
  await execFileAsync(
    "git",
    ["-C", repository, "config", "--local", "user.email", "alice@users.noreply.github.com"],
    {
      env: cleanEnvironment,
    },
  );
  await execFileAsync("git", ["-C", repository, "config", "--local", "commit.gpgsign", "true"], {
    env: cleanEnvironment,
  });
  return cleanEnvironment;
};

const signedCommit = (overrides: Partial<GithubCommitProvenance> = {}): GithubCommitProvenance => ({
  author: {
    email: "alice@users.noreply.github.com",
    name: "Alice Contributor",
    user: actor("alice"),
  },
  committer: {
    email: "alice@users.noreply.github.com",
    name: "Alice Contributor",
    user: actor("alice"),
  },
  message: "feat: add contributor-safe provenance",
  oid: "a".repeat(40),
  signature: {
    isValid: true,
    signer: actor("alice"),
    state: "VALID",
    wasSignedByGitHub: false,
  },
  ...overrides,
});

describe("commit email policy", () => {
  it.each([
    "test@example.com",
    "fixture@EXAMPLE.NET",
    "fixture@sub.example.org",
    "fixture@project.test",
    "fixture@subdomain.example",
    "fixture@host.invalid",
    "fixture@service.localhost",
  ])("rejects IANA special-use fixture address %s", (email) => {
    expect(isReservedCommitEmail(email)).toBe(true);
  });

  it.each(["test@real-company.com", "contributor@users.noreply.github.com", "noreply@github.com"])(
    "permits non-fixture address %s",
    (email) => {
      expect(isReservedCommitEmail(email)).toBe(false);
    },
  );
});

describe("local commit provenance preflight", () => {
  it("accepts any non-fixture identity with default signing enabled", () => {
    expect(
      validateLocalCommitConfiguration({
        authorIdent: "Alice Contributor <alice@users.noreply.github.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice Contributor <alice@users.noreply.github.com> 1 +0000",
      }),
    ).toEqual([]);

    expect(
      validateLocalCommitConfiguration({
        authorIdent: "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent:
          "dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> 1 +0000",
      }),
    ).toEqual([]);
  });

  it.each([
    {
      expected: "author identity",
      input: {
        authorIdent: "not-an-ident",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "reserved",
      input: {
        authorIdent: "Test <test@example.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Test <test@example.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <alice@@real-company.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <alice@real_company> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <alice@b..com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <.alice@real-company.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <alice.@real-company.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "author identity",
      input: {
        authorIdent: "Alice <alice..bob@real-company.com> 1 +0000",
        commitGpgSign: "true",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
    {
      expected: "commit.gpgsign",
      input: {
        authorIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
        commitGpgSign: "false",
        committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      },
    },
  ])("fails closed for $expected", ({ expected, input }) => {
    expect(validateLocalCommitConfiguration(input).join("\n")).toContain(expected);
  });

  it("reads effective identity and signing state without mutating Git config", async () => {
    const calls: string[][] = [];
    const values = new Map([
      ["var GIT_AUTHOR_IDENT", "Alice <alice@users.noreply.github.com> 1 +0000"],
      ["var GIT_COMMITTER_IDENT", "Alice <alice@users.noreply.github.com> 1 +0000"],
      ["config --bool --get commit.gpgsign", "true"],
    ]);

    const result = await inspectLocalCommitConfiguration(async (args) => {
      calls.push(args);
      return values.get(args.join(" ")) ?? "";
    });

    expect(result).toEqual({
      authorIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
      commitGpgSign: "true",
      committerIdent: "Alice <alice@users.noreply.github.com> 1 +0000",
    });
    expect(calls).toEqual([
      ["var", "GIT_AUTHOR_IDENT"],
      ["var", "GIT_COMMITTER_IDENT"],
      ["config", "--bool", "--get", "commit.gpgsign"],
    ]);
    expect(calls.flat()).not.toContain("--set");
    expect(calls.flat()).not.toContain("user.email");
    expect(calls.flat()).not.toContain("user.name");
  });

  it("rejects command-scoped fixture identity and signing overrides", async () => {
    const repository = await mkdtemp(path.join(tmpdir(), "loopworks-commit-provenance-"));
    try {
      const cleanGitEnvironment = await configureFixtureRepository(repository, process.env);

      const commandEnvironment: NodeJS.ProcessEnv = {
        ...cleanGitEnvironment,
        GIT_CONFIG_COUNT: "3",
        GIT_CONFIG_KEY_0: "user.name",
        GIT_CONFIG_VALUE_0: "Test",
        GIT_CONFIG_KEY_1: "user.email",
        GIT_CONFIG_VALUE_1: "test@example.com",
        GIT_CONFIG_KEY_2: "commit.gpgsign",
        GIT_CONFIG_VALUE_2: "false",
      };
      const configuration = await inspectLocalCommitConfiguration(
        async (args, environment = process.env) => {
          const result = await execFileAsync("git", args, {
            cwd: repository,
            env: environment,
          });
          return result.stdout;
        },
        commandEnvironment,
      );

      expect(configuration.authorIdent).toContain("test@example.com");
      expect(configuration.commitGpgSign).toBe("false");
      expect(validateLocalCommitConfiguration(configuration).join("\n")).toContain("reserved");
      expect(validateLocalCommitConfiguration(configuration).join("\n")).toContain(
        "commit.gpgsign",
      );
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("does not mutate a victim repository through inherited hook Git routing", async () => {
    const victim = await mkdtemp(path.join(tmpdir(), "loopworks-commit-provenance-victim-"));
    const repository = await mkdtemp(path.join(tmpdir(), "loopworks-commit-provenance-fixture-"));
    const hookEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_DIR: path.join(victim, ".git"),
      GIT_WORK_TREE: victim,
    };
    const cleanEnvironment = withoutGitEnvironment(hookEnvironment);

    try {
      await execFileAsync("git", ["init", "--quiet", victim], { env: cleanEnvironment });
      await execFileAsync("git", ["-C", victim, "config", "--local", "user.name", "Victim"], {
        env: cleanEnvironment,
      });
      await execFileAsync(
        "git",
        ["-C", victim, "config", "--local", "user.email", "victim@real-company.com"],
        { env: cleanEnvironment },
      );
      const before = await execFileAsync(
        "git",
        ["-C", victim, "config", "--local", "--list", "--null"],
        { env: cleanEnvironment },
      );

      await configureFixtureRepository(repository, hookEnvironment);

      const after = await execFileAsync(
        "git",
        ["-C", victim, "config", "--local", "--list", "--null"],
        { env: cleanEnvironment },
      );
      expect(after.stdout).toBe(before.stdout);
    } finally {
      await rm(repository, { recursive: true, force: true });
      await rm(victim, { recursive: true, force: true });
    }
  });
});

describe("GitHub-authoritative commit provenance", () => {
  it("accepts a signed contributor and a maintainer-signed contributor commit", () => {
    expect(validateGithubCommit(signedCommit())).toEqual([]);
    expect(
      validateGithubCommit(
        signedCommit({
          committer: {
            email: "maintainer@users.noreply.github.com",
            name: "Maintainer",
            user: actor("maintainer"),
          },
          signature: {
            isValid: true,
            signer: actor("maintainer"),
            state: "VALID",
            wasSignedByGitHub: false,
          },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    {
      label: "GitHub web-flow",
      value: signedCommit({
        committer: { email: "noreply@github.com", name: "GitHub", user: null },
        signature: {
          isValid: true,
          signer: actor("web-flow"),
          state: "VALID",
          wasSignedByGitHub: true,
        },
      }),
    },
    {
      label: "Dependabot",
      value: signedCommit({
        author: {
          email: "49699333+dependabot[bot]@users.noreply.github.com",
          name: "dependabot[bot]",
          user: actor("dependabot[bot]"),
        },
        committer: { email: "noreply@github.com", name: "GitHub", user: null },
        signature: {
          isValid: true,
          signer: actor("web-flow"),
          state: "VALID",
          wasSignedByGitHub: true,
        },
      }),
    },
  ])("accepts verified $label commits", ({ value }) => {
    expect(validateGithubCommit(value)).toEqual([]);
  });

  it.each([
    {
      expected: "resolved GitHub author",
      value: signedCommit({
        author: { email: "alice@users.noreply.github.com", name: "Alice", user: null },
      }),
    },
    { expected: "signed", value: signedCommit({ signature: null }) },
    {
      expected: "valid",
      value: signedCommit({
        signature: {
          isValid: false,
          signer: actor("alice"),
          state: "INVALID",
          wasSignedByGitHub: false,
        },
      }),
    },
    {
      expected: "resolved GitHub signer",
      value: signedCommit({
        signature: {
          isValid: true,
          signer: null,
          state: "VALID",
          wasSignedByGitHub: false,
        },
      }),
    },
    {
      expected: "author or committer",
      value: signedCommit({
        signature: {
          isValid: true,
          signer: actor("mallory"),
          state: "VALID",
          wasSignedByGitHub: false,
        },
      }),
    },
    {
      expected: "reserved",
      value: signedCommit({
        message: "feat: example\n\nCo-authored-by: Fixture <fixture@sub.example.com>",
      }),
    },
  ])("rejects $expected", ({ expected, value }) => {
    expect(validateGithubCommit(value).join("\n")).toContain(expected);
  });

  it("uses the real GraphQL boundary and paginates every pull-request commit", async () => {
    const cursors: Array<string | null> = [];
    mswServer.use(
      http.post("https://api.github.com/graphql", async ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer github-token");
        const body = (await request.json()) as {
          query: string;
          variables: { cursor: string | null; name: string; number: number; owner: string };
        };
        expect(body.query).toContain("signature");
        cursors.push(body.variables.cursor);
        const firstPage = body.variables.cursor === null;
        return HttpResponse.json({
          data: {
            repository: {
              pullRequest: {
                commits: {
                  nodes: [{ commit: signedCommit({ oid: (firstPage ? "a" : "b").repeat(40) }) }],
                  pageInfo: {
                    endCursor: firstPage ? "next-page" : null,
                    hasNextPage: firstPage,
                  },
                },
              },
            },
          },
        });
      }),
    );

    await expect(
      fetchPullRequestCommits({
        pullRequestNumber: 209,
        repository: "ncolesummers/loopworks",
        token: "github-token",
      }),
    ).resolves.toHaveLength(2);
    expect(cursors).toEqual([null, "next-page"]);
  });
});
