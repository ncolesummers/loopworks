import { readFileSync } from "node:fs";

import { assertPreviewMigrationLease } from "../../../scripts/assert-preview-migration-lease";

const commitSha = "0bf80d1aa1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";

function githubResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

function pullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changed_files: 1,
    head: { sha: commitSha },
    labels: [],
    ...overrides,
  };
}

function previewEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_SHA: commitSha,
    VERCEL_GIT_PULL_REQUEST_ID: "285",
    VERCEL_GIT_REPO_OWNER: "ncolesummers",
    VERCEL_GIT_REPO_SLUG: "loopworks",
    LOOPWORKS_PREVIEW_GITHUB_TOKEN: "preview-github-token",
    ...overrides,
  };
}

describe("Preview migration lease", () => {
  it("runs the Preview lease gate before db:migrate in Vercel builds", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["vercel-build"]).toBe("bun run db:migrate && bun run build:next");
  });

  it("refuses an unlabelled schema pull request before migrations can reach Postgres", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest());
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      if (url.includes("/pulls?")) return githubResponse([]);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/preview:alias/);
    expect(fetchGithub).toHaveBeenCalledTimes(4);
  });

  it("rejects a stale Preview build before it reads the live PR file list", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).endsWith("/pulls/285")) return githubResponse(pullRequest());
      throw new Error("files must not be read for a stale build");
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment({ VERCEL_GIT_COMMIT_SHA: "a".repeat(40) }), {
        fetchGithub,
      }),
    ).rejects.toThrow(/does not match the live pull request head/);
    expect(fetchGithub).toHaveBeenCalledTimes(1);
  });

  it("rejects a PR head that changes while the same-size file list is classified", async () => {
    let pullRequestReads = 0;
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        pullRequestReads += 1;
        return githubResponse(
          pullRequest({ head: { sha: pullRequestReads === 1 ? commitSha : "a".repeat(40) } }),
        );
      }
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "docs/runbook.md" }]);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/changed while its PR files were being classified/);
    expect(fetchGithub).toHaveBeenCalledTimes(3);
  });

  it("classifies an exact-head non-database Preview PR as build-only", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest());
      if (url.includes("/pulls/285/files")) return githubResponse([{ filename: "README.md" }]);
      throw new Error(`unexpected request: ${url}`);
    });
    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).resolves.toEqual({
      status: "non_database_preview",
    });
  });

  it("treats a Preview deployment without a PR ID as build-only, but rejects malformed non-empty IDs", async () => {
    const fetchGithub = vi.fn(async () => {
      throw new Error("a PR-less preview must not call GitHub");
    });

    await expect(
      assertPreviewMigrationLease(
        { ...previewEnvironment(), VERCEL_GIT_PULL_REQUEST_ID: "" },
        { fetchGithub },
      ),
    ).resolves.toEqual({ status: "unassociated_preview" });
    await expect(
      assertPreviewMigrationLease(
        previewEnvironment({ VERCEL_GIT_PULL_REQUEST_ID: "not-a-number" }),
        { fetchGithub },
      ),
    ).rejects.toThrow(/positive VERCEL_GIT_PULL_REQUEST_ID/);
    expect(fetchGithub).not.toHaveBeenCalled();
  });

  it("allows the exact current head only when it is the sole labelled schema PR", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files")) {
        return githubResponse([{ filename: "src/db/schema.ts" }]);
      }
      if (url.includes("/pulls?")) {
        return githubResponse([
          { head: { sha: commitSha }, number: 285, labels: [{ name: "preview:alias" }] },
        ]);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).resolves.toEqual({ status: "admitted" });
    await expect(
      assertPreviewMigrationLease({ VERCEL_ENV: "production" }, { fetchGithub }),
    ).resolves.toEqual({ status: "not_preview" });
    await expect(assertPreviewMigrationLease({}, { fetchGithub })).resolves.toEqual({
      status: "not_preview",
    });
    expect(fetchGithub).toHaveBeenCalledTimes(4);
  });

  it("refuses a labelled schema pull request while another lease holder is open", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files")) {
        return githubResponse([{ filename: "src/db/schema.ts" }]);
      }
      if (url.includes("/pulls?")) {
        return githubResponse([
          { head: { sha: commitSha }, number: 285, labels: [{ name: "preview:alias" }] },
          { head: { sha: commitSha }, number: 286, labels: [{ name: "preview:alias" }] },
        ]);
      }
      if (url.includes("/pulls?")) return githubResponse([]);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/285, 286/);
  });

  it("classifies renamed database runners and package changes as lease-sensitive", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest({ changed_files: 5 }));
      if (url.includes("/pulls/285/files")) {
        return githubResponse([
          { filename: "package.json" },
          { filename: "scripts/renamed.ts", previous_filename: "scripts/migrate-database.ts" },
          { filename: "src/lib/github/repository-selection-store.ts" },
          { filename: "src/lib/loops/development-run.ts" },
          { filename: "src/components/portal-shell.tsx" },
        ]);
      }
      if (url.includes("/pulls?")) return githubResponse([]);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/preview:alias/);
  });

  it("classifies vercel.json changes as lease-sensitive", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest());
      if (url.includes("/pulls/285/files")) return githubResponse([{ filename: "vercel.json" }]);
      if (url.includes("/pulls?")) return githubResponse([]);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/preview:alias/);
  });

  it("reads every GitHub files page and fails closed when the count is incomplete or capped", async () => {
    const paginatedFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest({ changed_files: 2 }));
      if (url.includes("/pulls/285/files") && !url.includes("page=2")) {
        return githubResponse([{ filename: "docs/runbook.md" }], 200, {
          link: '<https://api.github.com/repos/ncolesummers/loopworks/pulls/285/files?per_page=100&page=2>; rel="next"',
        });
      }
      if (url.includes("/pulls/285/files") && url.includes("page=2")) {
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      }
      if (url.includes("/pulls?")) return githubResponse([]);
      throw new Error(`unexpected request: ${url}`);
    });
    const incompleteFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest({ changed_files: 2 }));
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      throw new Error(`unexpected request: ${url}`);
    });
    const cappedFetch = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ changed_files: 3_000 }));
      }
      throw new Error("capped PR must not read files");
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: paginatedFetch }),
    ).rejects.toThrow(/preview:alias/);
    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: incompleteFetch }),
    ).rejects.toThrow(/incomplete PR file list/);
    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: cappedFetch }),
    ).rejects.toThrow(/capped pull request/);
  });

  it("fails closed for malformed labels in current and competing pull requests", async () => {
    const malformedCurrentFetch = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).endsWith("/pulls/285"))
        return githubResponse(pullRequest({ labels: null }));
      throw new Error("files must not be read after malformed current labels");
    });
    const malformedHolderFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      if (url.includes("/pulls?")) {
        return githubResponse([{ head: { sha: commitSha }, number: 285, labels: null }]);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: malformedCurrentFetch }),
    ).rejects.toThrow(/malformed pull request labels/);
    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: malformedHolderFetch }),
    ).rejects.toThrow(/malformed open pull request labels/);
  });

  it("accepts exactly 100 holders-page entries when GitHub supplies no next link", async () => {
    const openPullRequests = Array.from({ length: 100 }, (_, index) => ({
      head: { sha: commitSha },
      labels: index === 0 ? [{ name: "preview:alias" }] : [],
      number: index === 0 ? 285 : index + 300,
    }));
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      if (url.includes("/pulls?")) return githubResponse(openPullRequests);
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).resolves.toEqual({ status: "admitted" });
  });

  it("follows a safe next link beyond the first 100 holder entries and rejects malformed links", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      head: { sha: commitSha },
      labels: [],
      number: index + 300,
    }));
    const paginatedFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      if (url.includes("page=2")) {
        return githubResponse([
          { head: { sha: commitSha }, labels: [{ name: "preview:alias" }], number: 285 },
        ]);
      }
      if (url.includes("/pulls?")) {
        return githubResponse(firstPage, 200, {
          link: '<https://api.github.com/repos/ncolesummers/loopworks/pulls?state=open&per_page=100&page=2>; rel="next"',
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const malformedLinkFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) {
        return githubResponse(pullRequest({ labels: [{ name: "preview:alias" }] }));
      }
      if (url.includes("/pulls/285/files"))
        return githubResponse([{ filename: "drizzle/0004.sql" }]);
      if (url.includes("/pulls?")) {
        return githubResponse(
          [{ head: { sha: commitSha }, labels: [{ name: "preview:alias" }], number: 285 }],
          200,
          {
            link: '<https://example.com/pulls?page=2>; rel="next"',
          },
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: paginatedFetch }),
    ).resolves.toEqual({ status: "admitted" });
    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub: malformedLinkFetch }),
    ).rejects.toThrow(/unsafe pagination URL/);
  });

  it("fails closed when same-origin PR-file pagination cycles", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/pulls/285")) return githubResponse(pullRequest());
      if (url.includes("/pulls/285/files")) {
        return githubResponse([{ filename: "docs/runbook.md" }], 200, {
          link: '<https://api.github.com/repos/ncolesummers/loopworks/pulls/285/files?per_page=100>; rel="next"',
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(
      assertPreviewMigrationLease(previewEnvironment(), { fetchGithub }),
    ).rejects.toThrow(/cyclic file pagination/);
  });
});
