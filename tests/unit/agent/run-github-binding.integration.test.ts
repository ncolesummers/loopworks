/** @vitest-environment node */

import {
  type RunGithubBindingDatabase,
  resolveRunGithubBinding,
} from "@agent/lib/run-github-binding";
import { loopRuns, repositories } from "@/db/schema";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("planner run GitHub binding", () => {
  let context: PgliteTestDatabase;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  async function insertRun(
    input: {
      fullName?: string;
      installationId?: number | null;
      issueNumber?: number | null;
      name?: string;
      owner?: string;
    } = {},
  ): Promise<string> {
    const owner = input.owner ?? "ncolesummers";
    const name = input.name ?? "loopworks";
    const [repository] = await context.db
      .insert(repositories)
      .values({
        fullName: input.fullName ?? `${owner}/${name}`,
        githubRepoId: 172_000_001,
        installationId: input.installationId === undefined ? 172_001 : input.installationId,
        name,
        owner,
      })
      .returning({ id: repositories.id });
    if (!repository) throw new Error("Expected repository fixture.");
    const [run] = await context.db
      .insert(loopRuns)
      .values({
        githubIssueNumber: input.issueNumber === undefined ? 172 : input.issueNumber,
        loopKey: "development-loop",
        repositoryId: repository.id,
      })
      .returning({ id: loopRuns.id });
    if (!run) throw new Error("Expected run fixture.");
    return run.id;
  }

  it("resolves repository, installation, and current issue only from the durable run", async () => {
    const runId = await insertRun();

    await expect(
      resolveRunGithubBinding(runId, context.db as unknown as RunGithubBindingDatabase),
    ).resolves.toEqual({
      installationId: 172_001,
      issueNumber: 172,
      owner: "ncolesummers",
      repo: "loopworks",
      repositoryFullName: "ncolesummers/loopworks",
      runId,
    });
  });

  it.each([
    ["missing installation", { installationId: null }, "run_github_installation_unbound"],
    ["negative installation", { installationId: -1 }, "run_github_installation_unbound"],
    ["missing issue", { issueNumber: null }, "run_github_issue_unbound"],
    ["negative issue", { issueNumber: -1 }, "run_github_issue_unbound"],
    [
      "inconsistent repository identity",
      { fullName: "ncolesummers/other" },
      "run_github_repository_invalid",
    ],
  ])("fails closed for %s", async (_label, input, code) => {
    const runId = await insertRun(input);

    await expect(
      resolveRunGithubBinding(runId, context.db as unknown as RunGithubBindingDatabase),
    ).rejects.toThrow(code);
  });

  it("maps database failures to a stable non-secret error", async () => {
    const database = {
      select: vi.fn(() => {
        throw new Error("postgres password=database-secret");
      }),
    } as unknown as RunGithubBindingDatabase;

    const error = await resolveRunGithubBinding(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      database,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "run_github_binding_failed" });
    expect(JSON.stringify(error)).not.toContain("database-secret");
  });
});
