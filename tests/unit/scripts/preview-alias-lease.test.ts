import {
  assertExclusivePreviewAliasLease,
  assertLiveExclusivePreviewAliasLease,
} from "../../../scripts/assert-preview-alias-lease";

const expectedCommitSha = "0bf80d1aa1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";

describe("preview alias lease", () => {
  it("accepts the one open pull request holding preview:alias", () => {
    expect(() =>
      assertExclusivePreviewAliasLease({ holders: [285], pullRequest: 285 }),
    ).not.toThrow();
  });

  it("refuses a competing open pull request before it can repoint the alias", () => {
    expect(() =>
      assertExclusivePreviewAliasLease({ holders: [285, 286], pullRequest: 286 }),
    ).toThrow(/285, 286/);
  });

  it("refuses when this pull request no longer owns the lease", () => {
    expect(() => assertExclusivePreviewAliasLease({ holders: [285], pullRequest: 286 })).toThrow(
      /285/,
    );
  });

  it("refuses when no open pull request holds the lease", () => {
    expect(() => assertExclusivePreviewAliasLease({ holders: [], pullRequest: 285 })).toThrow(
      /none/,
    );
  });

  it("reads the live GitHub open-pull list with an injected fetch before alias mutation", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo, _init?: RequestInit) => {
      if (String(input).endsWith("/pulls/285")) {
        return new Response(
          JSON.stringify({
            head: { sha: expectedCommitSha },
            labels: [{ name: "preview:alias" }],
            state: "open",
          }),
        );
      }
      return new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]));
    });

    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub },
      ),
    ).resolves.toBeUndefined();
    expect(String(fetchGithub.mock.calls[0]?.[0])).toContain("/pulls?");
    expect(String(fetchGithub.mock.calls[1]?.[0])).toContain("/pulls/285");
    expect(fetchGithub.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer github-token",
    });
  });

  it("fails closed when a competing GitHub PR entry has malformed labels", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).endsWith("/pulls/285")) {
        return new Response(JSON.stringify({ head: { sha: expectedCommitSha } }));
      }
      return new Response(JSON.stringify([{ number: 285, labels: null }]));
    });

    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub },
      ),
    ).rejects.toThrow(/malformed open PRs/);
  });

  it("refuses an alias mutation when the live PR head changed after READY", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).includes("/pulls?")) {
        return new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]));
      }
      return new Response(JSON.stringify({ head: { sha: "a".repeat(40) }, state: "open" }));
    });

    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub },
      ),
    ).rejects.toThrow(/does not match the selected commit/);
    expect(fetchGithub).toHaveBeenCalledTimes(2);
  });

  it("refuses an alias mutation when the label is removed after holder pagination", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).includes("/pulls?")) {
        return new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]));
      }
      return new Response(
        JSON.stringify({ head: { sha: expectedCommitSha }, labels: [], state: "open" }),
      );
    });

    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub },
      ),
    ).rejects.toThrow(/no longer has preview:alias/);
  });

  it("refuses an alias mutation when the selected pull request closes after READY", async () => {
    const fetchGithub = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).includes("/pulls?")) {
        return new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]));
      }
      return new Response(
        JSON.stringify({
          head: { sha: expectedCommitSha },
          labels: [{ name: "preview:alias" }],
          state: "closed",
        }),
      );
    });
    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub },
      ),
    ).rejects.toThrow(/not open/);
  });

  it("fails closed for malformed final PR labels and cyclic holder pagination", async () => {
    const malformedLabels = vi.fn(async (input: URL | RequestInfo) => {
      if (String(input).includes("/pulls?")) {
        return new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]));
      }
      return new Response(
        JSON.stringify({ head: { sha: expectedCommitSha }, labels: null, state: "open" }),
      );
    });
    const cyclicPages = vi.fn(
      async () =>
        new Response(JSON.stringify([{ number: 285, labels: [{ name: "preview:alias" }] }]), {
          headers: {
            link: '<https://api.github.com/repos/ncolesummers/loopworks/pulls?state=open&per_page=100>; rel="next"',
          },
        }),
    );

    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub: malformedLabels },
      ),
    ).rejects.toThrow(/malformed pull request labels/);
    await expect(
      assertLiveExclusivePreviewAliasLease(
        {
          expectedCommitSha,
          pullRequest: 285,
          repository: "ncolesummers/loopworks",
          token: "github-token",
        },
        { fetchGithub: cyclicPages },
      ),
    ).rejects.toThrow(/cyclic holder pagination/);
  });
});
