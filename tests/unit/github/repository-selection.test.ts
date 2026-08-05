/** @vitest-environment node */

import type { AvailableGithubRepository } from "@/lib/github/installation-flow";
import {
  createGithubRepositorySelectionFlow,
  type GithubRepositorySelectionGateway,
  type GithubRepositorySelectionStore,
} from "@/lib/github/repository-selection";

const now = new Date("2026-08-04T12:00:00.000Z");

const installation = {
  accountLogin: "loopworks-org",
  accountType: "Organization",
  appId: 124,
  installationId: 124_001,
  repositorySelection: "selected",
};

const portal: AvailableGithubRepository = {
  archived: false,
  defaultBranch: "main",
  fullName: "loopworks-org/portal",
  githubRepoId: 900_001,
  name: "portal",
  owner: "loopworks-org",
  private: true,
};

const agent: AvailableGithubRepository = {
  archived: false,
  defaultBranch: "main",
  fullName: "loopworks-org/agent",
  githubRepoId: 900_002,
  name: "agent",
  owner: "loopworks-org",
  private: false,
};

function selectedRow(repository: AvailableGithubRepository) {
  return {
    defaultBranch: repository.defaultBranch,
    fullName: repository.fullName,
    githubRepoId: repository.githubRepoId,
    installationId: installation.installationId,
    name: repository.name,
    owner: repository.owner,
  };
}

function createFlow(
  overrides: {
    available?: AvailableGithubRepository[];
    deselect?: GithubRepositorySelectionStore["deselect"];
    installations?: (typeof installation)[];
    listInstallationRepositories?: GithubRepositorySelectionGateway["listInstallationRepositories"];
    select?: GithubRepositorySelectionStore["select"];
    selected?: ReturnType<typeof selectedRow>[];
  } = {},
) {
  const listInstallationRepositories =
    overrides.listInstallationRepositories ?? vi.fn(async () => overrides.available ?? [portal]);
  const select = overrides.select ?? vi.fn(async () => "selected" as const);
  const deselect = overrides.deselect ?? vi.fn(async () => "deselected" as const);
  const flow = createGithubRepositorySelectionFlow({
    gateway: { listInstallationRepositories },
    now: () => now,
    store: {
      deselect,
      listInstallations: vi.fn(async () => overrides.installations ?? [installation]),
      listSelected: vi.fn(async () => overrides.selected ?? []),
      select,
    },
  });
  return { deselect, flow, listInstallationRepositories, select };
}

describe("GitHub repository selection flow", () => {
  it("reports the not-connected state when no installation exists", async () => {
    const { flow, listInstallationRepositories } = createFlow({ installations: [] });

    await expect(flow.readSelection()).resolves.toEqual({ status: "not-connected" });
    expect(listInstallationRepositories).not.toHaveBeenCalled();
  });

  it("distinguishes an installation that reaches zero repositories from not-connected", async () => {
    const { flow } = createFlow({ available: [] });

    await expect(flow.readSelection()).resolves.toEqual({
      installation,
      repositories: [],
      status: "no-accessible-repositories",
    });
  });

  it("marks which accessible repositories are already selected", async () => {
    const { flow } = createFlow({
      available: [portal, agent],
      selected: [selectedRow(agent)],
    });

    await expect(flow.readSelection()).resolves.toEqual({
      installation,
      repositories: [
        { ...agent, accessible: true, selected: true },
        { ...portal, accessible: true, selected: false },
      ],
      status: "ready",
    });
  });

  it("keeps a selected repository the installation can no longer reach, marked inaccessible", async () => {
    const { flow } = createFlow({
      available: [agent],
      selected: [selectedRow(portal)],
    });

    await expect(flow.readSelection()).resolves.toMatchObject({
      repositories: [
        { accessible: true, githubRepoId: agent.githubRepoId, selected: false },
        { accessible: false, githubRepoId: portal.githubRepoId, selected: true },
      ],
      status: "ready",
    });
  });

  it("still surfaces revoked selections when access drops to zero repositories", async () => {
    const { flow } = createFlow({ available: [], selected: [selectedRow(portal)] });

    await expect(flow.readSelection()).resolves.toMatchObject({
      repositories: [{ accessible: false, githubRepoId: portal.githubRepoId, selected: true }],
      status: "no-accessible-repositories",
    });
  });

  it("surfaces a gateway failure as an error state instead of throwing", async () => {
    const { flow } = createFlow({
      listInstallationRepositories: vi.fn(async () => {
        throw new Error("github_repository_verification_failed");
      }),
    });

    await expect(flow.readSelection()).resolves.toEqual({
      reason: "github_repository_verification_failed",
      status: "error",
    });
  });

  it("persists selections using live repository identity", async () => {
    const { flow, select } = createFlow({ available: [portal, agent] });

    await expect(
      flow.applySelection({ deselect: [], select: [agent.githubRepoId] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: agent.githubRepoId, outcome: "selected" }],
      status: "applied",
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith({
      defaultBranch: "main",
      fullName: "loopworks-org/agent",
      githubRepoId: agent.githubRepoId,
      installationId: installation.installationId,
      name: "agent",
      now,
      owner: "loopworks-org",
    });
  });

  it("refuses to select a repository the installation cannot reach", async () => {
    const { flow, select } = createFlow({ available: [portal] });

    await expect(flow.applySelection({ deselect: [], select: [404_404] })).resolves.toEqual({
      outcomes: [{ githubRepoId: 404_404, outcome: "not-accessible" }],
      status: "applied",
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("reports a refused deselection without treating it as success", async () => {
    const { flow } = createFlow({
      deselect: vi.fn(async () => "in-use" as const),
      selected: [selectedRow(portal)],
    });

    await expect(
      flow.applySelection({ deselect: [portal.githubRepoId], select: [] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "in-use" }],
      status: "applied",
    });
  });

  it("deselects a repository the installation can no longer reach", async () => {
    const { deselect, flow } = createFlow({ available: [], selected: [selectedRow(portal)] });

    await expect(
      flow.applySelection({ deselect: [portal.githubRepoId], select: [] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "deselected" }],
      status: "applied",
    });
    expect(deselect).toHaveBeenCalledWith({
      githubRepoId: portal.githubRepoId,
      installationId: installation.installationId,
    });
  });

  it("reports committed writes when a later write in the batch fails", async () => {
    let calls = 0;
    const { flow } = createFlow({
      available: [portal, agent],
      select: async () => {
        calls += 1;
        if (calls === 2) throw new Error("connection_terminated");
        return "selected";
      },
    });

    await expect(
      flow.applySelection({
        deselect: [],
        select: [portal.githubRepoId, agent.githubRepoId],
      }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "selected" }],
      reason: "connection_terminated",
      status: "partial",
    });
  });

  it("reports a plain error when nothing was committed", async () => {
    const { flow } = createFlow({
      available: [portal],
      select: async () => {
        throw new Error("connection_terminated");
      },
    });

    await expect(
      flow.applySelection({ deselect: [], select: [portal.githubRepoId] }),
    ).resolves.toEqual({ reason: "connection_terminated", status: "error" });
  });

  it("rejects an apply request with no connected installation", async () => {
    const { flow, select } = createFlow({ installations: [] });

    await expect(flow.applySelection({ deselect: [], select: [900_001] })).resolves.toEqual({
      status: "not-connected",
    });
    expect(select).not.toHaveBeenCalled();
  });
});
