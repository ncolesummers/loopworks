/** @vitest-environment node */
import {
  executeListGithubBacklog,
  executeListGithubBacklogTaxonomy,
  executeReadGithubBacklogItem,
  listGithubBacklogInputSchema,
  listGithubBacklogTaxonomyInputSchema,
  readGithubBacklogItemInputSchema,
} from "@agent/subagents/planner/lib/github-backlog-tools";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const binding = {
  installationId: 172_001,
  issueNumber: 172,
  owner: "ncolesummers",
  repo: "loopworks",
  repositoryFullName: "ncolesummers/loopworks",
  runId,
};

function dependencies() {
  return {
    activeRunId: runId,
    fixtureMode: false,
    observe: vi.fn(() => ({ bind: vi.fn(), fail: vi.fn(), succeed: vi.fn() })),
    reader: {
      listBacklog: vi.fn(async () => ({
        fetchedAt: "2026-08-07T12:00:00.000Z",
        issues: [],
        provenance: "untrusted_external_evidence" as const,
        repositoryFullName: binding.repositoryFullName,
        truncated: false,
      })),
      listTaxonomy: vi.fn(async () => ({
        fetchedAt: "2026-08-07T12:00:00.000Z",
        labels: [],
        milestones: [],
        provenance: "untrusted_external_evidence" as const,
        repositoryFullName: binding.repositoryFullName,
        truncation: { labels: false, milestones: false },
      })),
      readBacklogItem: vi.fn(async () => ({
        body: "Body",
        comments: [],
        fetchedAt: "2026-08-07T12:00:00.000Z",
        issue: {
          assigneeLogins: [],
          authorAssociation: "OWNER",
          authorLogin: "author",
          closedAt: null,
          commentCount: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          labels: [],
          milestone: null,
          number: 172,
          state: "open" as const,
          stateReason: null,
          title: "Issue 172",
          updatedAt: "2026-08-02T00:00:00.000Z",
          url: "https://github.com/ncolesummers/loopworks/issues/172",
        },
        provenance: "untrusted_external_evidence" as const,
        relationships: { blockedBy: [], blocking: [], parent: null, subIssues: [] },
        repositoryFullName: binding.repositoryFullName,
        truncation: {
          blockedBy: false,
          blocking: false,
          body: false,
          comments: false,
          issue: false,
          parent: false,
          subIssues: false,
        },
      })),
    },
    resolveBinding: vi.fn(async () => binding),
  };
}

describe("planner GitHub backlog tools", () => {
  it("accepts only bounded planning inputs, never provider identities or routes", () => {
    expect(listGithubBacklogInputSchema.parse({})).toEqual({
      labels: [],
      limit: 50,
      state: "open",
    });
    for (const forbidden of [
      { runId },
      { installationId: 172_001 },
      { repositoryFullName: "other/repo" },
      { route: "GET /user/installations" },
      { auth: "ghs_secret" },
      { page: 2 },
    ]) {
      expect(listGithubBacklogInputSchema.safeParse(forbidden).success).toBe(false);
      expect(readGithubBacklogItemInputSchema.safeParse(forbidden).success).toBe(false);
      expect(listGithubBacklogTaxonomyInputSchema.safeParse(forbidden).success).toBe(false);
    }
  });

  it("resolves the run binding before every production provider read", async () => {
    const deps = dependencies();

    await executeListGithubBacklog({}, deps);
    await executeReadGithubBacklogItem({}, deps);
    await executeListGithubBacklogTaxonomy({}, deps);

    expect(deps.resolveBinding).toHaveBeenCalledTimes(3);
    expect(deps.reader.listBacklog).toHaveBeenCalledWith({
      installationId: 172_001,
      labels: [],
      limit: 50,
      milestoneNumber: undefined,
      owner: "ncolesummers",
      repo: "loopworks",
      state: "open",
    });
    expect(deps.reader.readBacklogItem).toHaveBeenCalledWith({
      commentLimit: 10,
      installationId: 172_001,
      issueNumber: 172,
      owner: "ncolesummers",
      repo: "loopworks",
    });
    expect(deps.reader.listTaxonomy).toHaveBeenCalledWith({
      installationId: 172_001,
      owner: "ncolesummers",
      repo: "loopworks",
    });
  });

  it("uses deterministic local fixtures without resolving credentials or durable state", async () => {
    const deps = { ...dependencies(), fixtureMode: true };

    await expect(executeListGithubBacklog({}, deps)).resolves.toMatchObject({
      issues: [expect.objectContaining({ number: 13 })],
      provenance: "untrusted_external_evidence",
    });
    await expect(executeReadGithubBacklogItem({}, deps)).resolves.toMatchObject({
      issue: { number: 13 },
      provenance: "untrusted_external_evidence",
    });
    await expect(executeListGithubBacklogTaxonomy({}, deps)).resolves.toMatchObject({
      labels: expect.arrayContaining([expect.objectContaining({ name: "area:agents" })]),
    });
    expect(deps.resolveBinding).not.toHaveBeenCalled();
    expect(deps.reader.listBacklog).not.toHaveBeenCalled();
  });

  it("reports metadata-only observations without raw GitHub prose", async () => {
    const deps = dependencies();

    await executeReadGithubBacklogItem({}, deps);

    expect(deps.observe).toHaveBeenCalledWith({
      provider: "github",
      runId,
      tool: "read_github_backlog_item",
    });
    expect(deps.observe.mock.results[0]?.value.bind).toHaveBeenCalledWith({
      issueNumber: 172,
      repositoryFullName: "ncolesummers/loopworks",
    });
    expect(JSON.stringify(deps.observe.mock.calls)).not.toContain("Body");
  });

  it("observes and sanitizes durable binding failures before any provider read", async () => {
    const deps = dependencies();
    const rawFailure = new Error("password=database-secret");
    deps.resolveBinding.mockRejectedValueOnce(rawFailure);

    const error = await executeListGithubBacklog({}, deps).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "run_github_binding_failed" });
    expect(error).not.toBe(rawFailure);
    expect(deps.observe).toHaveBeenCalledWith({
      provider: "github",
      runId,
      tool: "list_github_backlog",
    });
    const observation = deps.observe.mock.results[0]?.value;
    expect(observation.fail).toHaveBeenCalledWith(error);
    expect(deps.reader.listBacklog).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("database-secret");
  });
});
