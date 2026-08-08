/** @vitest-environment node */
import { generateKeyPairSync } from "node:crypto";
import {
  createGithubPlanningBacklogReader,
  GithubPlanningBacklogError,
} from "@agent/lib/github-backlog-reader";
import { HttpResponse, http } from "msw";
import { mswServer } from "../../helpers/msw";

const repository = {
  installationId: 172_001,
  owner: "ncolesummers",
  repo: "loopworks",
};

function issuePayload(number: number, overrides: Record<string, unknown> = {}) {
  return {
    assignees: [{ login: "maintainer" }],
    body: "Issue body",
    closed_at: null,
    comments: 1,
    created_at: "2026-08-01T00:00:00Z",
    labels: [{ name: "area:agents" }, "priority:p0"],
    milestone: {
      closed_issues: 1,
      description: "Milestone description",
      due_on: null,
      number: 5,
      open_issues: 2,
      state: "open",
      title: "M5 MVP Close",
    },
    number,
    repository_url: "https://api.github.com/repos/ncolesummers/loopworks",
    state: "open",
    state_reason: null,
    title: `Issue ${number}`,
    updated_at: "2026-08-02T00:00:00Z",
    user: { login: "author" },
    author_association: "OWNER",
    ...overrides,
  };
}

function commentPayload(id: number, body: string) {
  return {
    author_association: "OWNER",
    body,
    created_at: "2026-08-02T01:00:00Z",
    id,
    updated_at: "2026-08-02T02:00:00Z",
    user: { login: "maintainer" },
  };
}

function appPrivateKey(): string {
  return generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    format: "pem",
    type: "pkcs8",
  }) as string;
}

describe("GitHub planning backlog reader", () => {
  it("lists only issues through one fixed route and projects bounded safe fields", async () => {
    const request = vi.fn(async () => ({
      data: [
        issuePayload(172, {
          body: "not returned from list",
          private_provider_field: "token=provider-secret",
          title: "Planner token=ghp_deadbeef",
        }),
        issuePayload(173, { pull_request: { url: "https://api.github.com/pulls/173" } }),
      ],
      headers: {},
    }));
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({ request })),
      now: () => new Date("2026-08-07T12:00:00.000Z"),
    });

    await expect(
      reader.listBacklog({
        ...repository,
        labels: ["area:agents"],
        limit: 50,
        milestoneNumber: 5,
        state: "open",
      }),
    ).resolves.toEqual({
      fetchedAt: "2026-08-07T12:00:00.000Z",
      issues: [
        expect.objectContaining({
          authorAssociation: "OWNER",
          authorLogin: "author",
          labels: ["area:agents", "priority:p0"],
          number: 172,
          title: "Planner token=[REDACTED]",
          url: "https://github.com/ncolesummers/loopworks/issues/172",
        }),
      ],
      provenance: "untrusted_external_evidence",
      repositoryFullName: "ncolesummers/loopworks",
      truncated: false,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("GET /repos/{owner}/{repo}/issues", {
      direction: "desc",
      headers: { "x-github-api-version": "2026-03-10" },
      labels: "area:agents",
      milestone: "5",
      owner: "ncolesummers",
      per_page: 50,
      repo: "loopworks",
      sort: "updated",
      state: "open",
    });
    expect(
      JSON.stringify((await reader.listBacklog({ ...repository, limit: 1 })).issues),
    ).not.toContain("private_provider_field");
  });

  it("rejects relationship or issue payloads outside the run-bound repository", async () => {
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({
        request: vi.fn(async () => ({
          data: [
            issuePayload(172, {
              repository_url: "https://api.github.com/repos/other/private-repo",
            }),
          ],
          headers: {},
        })),
      })),
    });

    await expect(reader.listBacklog({ ...repository, limit: 50 })).rejects.toMatchObject({
      code: "github_backlog_payload_invalid",
    });
  });

  it("reads one issue with bounded comments, hierarchy, dependencies, and provenance", async () => {
    const request = vi.fn(async (route: string) => {
      if (route.endsWith("/comments")) {
        return {
          data: [commentPayload(1, "Decision token=ghp_commentsecret")],
          headers: {
            link: '<https://api.github.com/example?page=2>; rel="next"',
          },
        };
      }
      if (route.endsWith("/parent")) return { data: issuePayload(16), headers: {} };
      if (route.endsWith("/sub_issues")) return { data: [issuePayload(173)], headers: {} };
      if (route.endsWith("/dependencies/blocked_by")) {
        return { data: [issuePayload(122)], headers: {} };
      }
      if (route.endsWith("/dependencies/blocking")) {
        return { data: [issuePayload(174)], headers: {} };
      }
      return {
        data: issuePayload(172, {
          body: [
            "Canonical body secret=very-sensitive",
            "Authorization: Basic Z2h1c2VyOnN1cGVyc2VjcmV0",
            "Cookie: first=one; session=supersecret",
          ].join("\n"),
          private_key: "should never be projected",
        }),
        headers: {},
      };
    });
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({ request })),
      now: () => new Date("2026-08-07T12:00:00.000Z"),
    });

    const result = await reader.readBacklogItem({
      ...repository,
      commentLimit: 10,
      issueNumber: 172,
    });

    expect(result).toMatchObject({
      body: [
        "Canonical body secret=[REDACTED]",
        "Authorization: [REDACTED]",
        "Cookie: [REDACTED]",
      ].join("\n"),
      comments: [
        {
          authorAssociation: "OWNER",
          authorLogin: "maintainer",
          body: "Decision token=[REDACTED]",
          id: 1,
          url: "https://github.com/ncolesummers/loopworks/issues/172#issuecomment-1",
        },
      ],
      issue: { number: 172 },
      provenance: "untrusted_external_evidence",
      relationships: {
        blockedBy: [{ number: 122 }],
        blocking: [{ number: 174 }],
        parent: { number: 16 },
        subIssues: [{ number: 173 }],
      },
      truncation: { comments: true },
    });
    expect(JSON.stringify(result)).not.toContain("should never be projected");
    expect(JSON.stringify(result)).not.toContain("Z2h1c2VyOnN1cGVyc2VjcmV0");
    expect(JSON.stringify(result)).not.toContain("supersecret");
    expect(request.mock.calls.map(([route]) => route)).toEqual([
      "GET /repos/{owner}/{repo}/issues/{issue_number}",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/parent",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by",
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking",
    ]);
  });

  it("reports every omitted issue, parent, and comment field as truncated", async () => {
    const manyLabels = Array.from({ length: 21 }, (_, index) => ({ name: `label-${index}` }));
    const request = vi.fn(async (route: string) => {
      if (route.endsWith("/comments")) throw new Error("comments must not be requested");
      if (route.endsWith("/parent")) {
        return { data: issuePayload(16, { labels: manyLabels }), headers: {} };
      }
      if (
        route.endsWith("/sub_issues") ||
        route.endsWith("/dependencies/blocked_by") ||
        route.endsWith("/dependencies/blocking")
      ) {
        return { data: [], headers: {} };
      }
      return { data: issuePayload(172, { comments: 3, labels: manyLabels }), headers: {} };
    });
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({ request })),
    });

    await expect(
      reader.readBacklogItem({ ...repository, commentLimit: 0, issueNumber: 172 }),
    ).resolves.toMatchObject({
      comments: [],
      truncation: { comments: true, issue: true, parent: true },
    });
  });

  it("reports truncated author and assignee identities", async () => {
    const request = vi.fn(async () => ({
      data: [
        issuePayload(172, {
          assignees: [{ login: "a".repeat(101) }],
          user: { login: "u".repeat(101) },
        }),
      ],
      headers: {},
    }));
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({ request })),
    });

    await expect(reader.listBacklog({ ...repository, limit: 50 })).resolves.toMatchObject({
      issues: [{ assigneeLogins: ["a".repeat(100)], authorLogin: "u".repeat(100) }],
      truncated: true,
    });
  });

  it("rejects permissive non-ISO provider timestamps", async () => {
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({
        request: vi.fn(async () => ({
          data: [issuePayload(172, { created_at: "1" })],
          headers: {},
        })),
      })),
    });

    await expect(reader.listBacklog({ ...repository, limit: 50 })).rejects.toMatchObject({
      code: "github_backlog_payload_invalid",
    });
  });

  it("lists a bounded redacted label and milestone taxonomy", async () => {
    const request = vi.fn(async (route: string) =>
      route.endsWith("/labels")
        ? {
            data: [
              {
                description: `token=ghp_labelsecret ${"x".repeat(600)}`,
                name: "area:agents",
              },
            ],
            headers: {},
          }
        : {
            data: [
              {
                closed_issues: 2,
                description: `secret=milestone-secret ${"x".repeat(2_100)}`,
                due_on: null,
                number: 5,
                open_issues: 3,
                state: "open",
                title: "M5",
              },
            ],
            headers: {},
          },
    );
    const reader = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({ request })),
      now: () => new Date("2026-08-07T12:00:00.000Z"),
    });

    await expect(reader.listTaxonomy(repository)).resolves.toMatchObject({
      labels: [{ description: expect.stringMatching(/^token=\[REDACTED\]/), name: "area:agents" }],
      milestones: [
        { description: expect.stringMatching(/^secret=\[REDACTED\]/), number: 5, title: "M5" },
      ],
      provenance: "untrusted_external_evidence",
      truncation: { labels: true, milestones: true },
    });
    expect(request.mock.calls.map(([route]) => route)).toEqual([
      "GET /repos/{owner}/{repo}/labels",
      "GET /repos/{owner}/{repo}/milestones",
    ]);
  });

  it("fails closed with stable errors for malformed payloads and redacts provider failures", async () => {
    const malformed = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({
        request: vi.fn(async () => ({ data: [{ number: 172 }], headers: {} })),
      })),
    });
    await expect(malformed.listBacklog({ ...repository, limit: 50 })).rejects.toMatchObject({
      code: "github_backlog_payload_invalid",
      message: "github_backlog_payload_invalid",
    });

    const failed = createGithubPlanningBacklogReader({
      getInstallationClient: vi.fn(async () => ({
        request: vi.fn(async () => {
          throw new Error("Authorization: Bearer ghs_provider-secret");
        }),
      })),
    });
    const error = await failed
      .listBacklog({ ...repository, limit: 50 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GithubPlanningBacklogError);
    expect(error).toMatchObject({
      code: "github_backlog_provider_failed",
      message: "github_backlog_provider_failed",
    });
    expect(JSON.stringify(error)).not.toContain("provider-secret");
  });

  it("uses the default installation client and sends its token only to fixed GitHub routes", async () => {
    const authorization: (string | null)[] = [];
    mswServer.use(
      http.post("https://api.github.com/app/installations/:installationId/access_tokens", () =>
        HttpResponse.json(
          { expires_at: "2099-01-01T00:00:00Z", token: "ghs_installation" },
          { status: 201 },
        ),
      ),
      http.get("https://api.github.com/repos/ncolesummers/loopworks/issues", ({ request }) => {
        authorization.push(request.headers.get("authorization"));
        expect(request.headers.get("x-github-api-version")).toBe("2026-03-10");
        return HttpResponse.json([issuePayload(172)]);
      }),
    );
    const reader = createGithubPlanningBacklogReader({
      appCredentials: { appId: 172, privateKey: appPrivateKey() },
      now: () => new Date("2026-08-07T12:00:00.000Z"),
    });

    await expect(reader.listBacklog({ ...repository, limit: 50 })).resolves.toMatchObject({
      issues: [{ number: 172 }],
    });
    expect(authorization).toEqual(["token ghs_installation"]);
  });
});
