/** @vitest-environment node */

import type { AvailableGithubRepository } from "@/lib/github/installation-flow";
import {
  createGithubRepositorySelectionFlow,
  type GithubRepositorySelectionGateway,
  type GithubRepositorySelectionStore,
} from "@/lib/github/repository-selection";
import {
  createRepositorySelectionAuthorizationCache,
  createRepositorySelectionAuthorizer,
  repositorySelectionAuthorizationMonotonicNow,
} from "@/lib/github/repository-selection-authorization";

const now = new Date("2026-08-04T12:00:00.000Z");

const subject = {
  authUserId: "auth-user-operator",
  githubProviderAccountId: "22808397",
};

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
    authorizeInstallationAccess?: () => Promise<{
      cacheHit: boolean;
      outcome: "access-denied" | "authorized" | "indeterminate";
    }>;
    listInstallationRepositories?: GithubRepositorySelectionGateway["listInstallationRepositories"];
    listSelected?: GithubRepositorySelectionStore["listSelected"];
    select?: GithubRepositorySelectionStore["select"];
    selected?: ReturnType<typeof selectedRow>[];
  } = {},
) {
  const listInstallationRepositories =
    overrides.listInstallationRepositories ?? vi.fn(async () => overrides.available ?? [portal]);
  const select = overrides.select ?? vi.fn(async () => "selected" as const);
  const deselect = overrides.deselect ?? vi.fn(async () => "deselected" as const);
  const authorizeInstallationAccess =
    overrides.authorizeInstallationAccess ??
    vi.fn(async () => ({ cacheHit: false, outcome: "authorized" as const }));
  const listSelected = overrides.listSelected ?? vi.fn(async () => overrides.selected ?? []);
  const flow = createGithubRepositorySelectionFlow({
    authorizeInstallationAccess,
    gateway: { listInstallationRepositories },
    now: () => now,
    store: {
      deselect,
      listInstallations: vi.fn(async () => overrides.installations ?? [installation]),
      listSelected,
      select,
    },
  });
  return {
    authorizeInstallationAccess,
    deselect,
    flow,
    listInstallationRepositories,
    listSelected,
    select,
  };
}

describe("GitHub repository selection flow", () => {
  it.each(["readSelection", "applySelection"] as const)(
    "denies %s before selected-row reads, App calls, or writes",
    async (operation) => {
      const { deselect, flow, listInstallationRepositories, listSelected, select } = createFlow({
        authorizeInstallationAccess: vi.fn(async () => ({
          cacheHit: false,
          outcome: "access-denied" as const,
        })),
      });

      const result =
        operation === "readSelection"
          ? await flow.readSelection(subject)
          : await flow.applySelection(subject, {
              deselect: [portal.githubRepoId],
              select: [agent.githubRepoId],
            });

      expect(result).toEqual({ status: "access-denied" });
      expect(listSelected).not.toHaveBeenCalled();
      expect(listInstallationRepositories).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(deselect).not.toHaveBeenCalled();
    },
  );

  it.each(["readSelection", "applySelection"] as const)(
    "fails %s closed on indeterminate evidence before any downstream access",
    async (operation) => {
      const { deselect, flow, listInstallationRepositories, listSelected, select } = createFlow({
        authorizeInstallationAccess: vi.fn(async () => ({
          cacheHit: false,
          outcome: "indeterminate" as const,
        })),
      });

      const result =
        operation === "readSelection"
          ? await flow.readSelection(subject)
          : await flow.applySelection(subject, {
              deselect: [portal.githubRepoId],
              select: [agent.githubRepoId],
            });

      expect(result).toEqual({
        reason: "github_repository_selection_authorization_indeterminate",
        status: "error",
      });
      expect(listSelected).not.toHaveBeenCalled();
      expect(listInstallationRepositories).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(deselect).not.toHaveBeenCalled();
    },
  );

  it("passes only the typed actor subject and resolved installation to authorization", async () => {
    const authorizeInstallationAccess = vi.fn(async () => ({
      cacheHit: false,
      outcome: "authorized" as const,
    }));
    const { flow } = createFlow({ authorizeInstallationAccess });

    await flow.readSelection(subject);

    expect(authorizeInstallationAccess).toHaveBeenCalledWith(subject, installation);
    expect(JSON.stringify(authorizeInstallationAccess.mock.calls)).not.toContain("ghu_");
  });

  it("observes only the bounded authorization decision, never subject or installation evidence", async () => {
    const observeAuthorizationOutcome = vi.fn();
    const flow = createGithubRepositorySelectionFlow({
      authorizeInstallationAccess: async () => ({ cacheHit: true, outcome: "authorized" }),
      gateway: { listInstallationRepositories: async () => [] },
      now: () => now,
      observeAuthorizationOutcome,
      store: {
        deselect: vi.fn(),
        listInstallations: async () => [installation],
        listSelected: async () => [],
        select: vi.fn(),
      },
    });

    await flow.readSelection({
      authUserId: "auth-user-token-ghu_observation_canary",
      githubProviderAccountId: "22808397",
    });

    expect(observeAuthorizationOutcome).toHaveBeenCalledWith({
      cacheHit: true,
      operation: "read",
      outcome: "authorized",
    });
    const serialized = JSON.stringify(observeAuthorizationOutcome.mock.calls);
    expect(serialized).not.toContain("ghu_observation_canary");
    expect(serialized).not.toContain("22808397");
    expect(serialized).not.toContain("loopworks-org");
    expect(serialized).not.toContain("124001");
  });

  it("reports the not-connected state when no installation exists", async () => {
    const { flow, listInstallationRepositories } = createFlow({ installations: [] });

    await expect(flow.readSelection(subject)).resolves.toEqual({ status: "not-connected" });
    expect(listInstallationRepositories).not.toHaveBeenCalled();
  });

  it("distinguishes an installation that reaches zero repositories from not-connected", async () => {
    const { flow } = createFlow({ available: [] });

    await expect(flow.readSelection(subject)).resolves.toEqual({
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

    await expect(flow.readSelection(subject)).resolves.toEqual({
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

    await expect(flow.readSelection(subject)).resolves.toMatchObject({
      repositories: [
        { accessible: true, githubRepoId: agent.githubRepoId, selected: false },
        { accessible: false, githubRepoId: portal.githubRepoId, selected: true },
      ],
      status: "ready",
    });
  });

  it("still surfaces revoked selections when access drops to zero repositories", async () => {
    const { flow } = createFlow({ available: [], selected: [selectedRow(portal)] });

    await expect(flow.readSelection(subject)).resolves.toMatchObject({
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

    await expect(flow.readSelection(subject)).resolves.toEqual({
      reason: "github_repository_verification_failed",
      status: "error",
    });
  });

  it("persists selections using live repository identity", async () => {
    const { flow, select } = createFlow({ available: [portal, agent] });

    await expect(
      flow.applySelection(subject, { deselect: [], select: [agent.githubRepoId] }),
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

    await expect(
      flow.applySelection(subject, { deselect: [], select: [404_404] }),
    ).resolves.toEqual({
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
      flow.applySelection(subject, { deselect: [portal.githubRepoId], select: [] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "in-use" }],
      status: "applied",
    });
  });

  it("deselects a repository the installation can no longer reach", async () => {
    const { deselect, flow } = createFlow({ available: [], selected: [selectedRow(portal)] });

    await expect(
      flow.applySelection(subject, { deselect: [portal.githubRepoId], select: [] }),
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
      flow.applySelection(subject, {
        deselect: [],
        select: [portal.githubRepoId, agent.githubRepoId],
      }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "selected" }],
      reason: "github_repository_selection_failed",
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
      flow.applySelection(subject, { deselect: [], select: [portal.githubRepoId] }),
    ).resolves.toEqual({ reason: "github_repository_selection_failed", status: "error" });
  });

  it("rejects an apply request with no connected installation", async () => {
    const { flow, select } = createFlow({ installations: [] });

    await expect(
      flow.applySelection(subject, { deselect: [], select: [900_001] }),
    ).resolves.toEqual({
      status: "not-connected",
    });
    expect(select).not.toHaveBeenCalled();
  });
});

describe("GitHub repository selection authorization cache", () => {
  function createAuthorizer(
    input: {
      appId?: number;
      authGithubClientId?: string;
      cache?: ReturnType<typeof createRepositorySelectionAuthorizationCache>;
      now?: () => number;
      readAccessEvidence?: () => Promise<{ accessToken: string } | null>;
      userCanAccessInstallation?: (accessToken: string, installationId: number) => Promise<boolean>;
    } = {},
  ) {
    const readAccessEvidence =
      input.readAccessEvidence ?? vi.fn(async () => ({ accessToken: "ghu_access_token_canary" }));
    const userCanAccessInstallation = input.userCanAccessInstallation ?? vi.fn(async () => true);
    const now = input.now ?? (() => Date.parse("2026-08-15T12:00:00.000Z"));
    const cache =
      input.cache ?? createRepositorySelectionAuthorizationCache({ now, ttlMs: 60_000 });
    return {
      authorizer: createRepositorySelectionAuthorizer({
        appId: input.appId ?? 124,
        authGithubClientId: input.authGithubClientId ?? "Iv23li-loopworks",
        cache,
        githubAppClientId: "Iv23li-loopworks",
        readAccessEvidence,
        userCanAccessInstallation,
      }),
      cache,
      readAccessEvidence,
      userCanAccessInstallation,
    };
  }

  it("keys positive decisions by immutable provider, App, and installation and expires at 60 seconds", async () => {
    let nowMs = Date.parse("2026-08-15T12:00:00.000Z");
    const cache = createRepositorySelectionAuthorizationCache({
      now: () => nowMs,
      ttlMs: 60_000,
    });
    const accessCheck = vi.fn(async () => true);
    const first = createAuthorizer({ cache, userCanAccessInstallation: accessCheck });

    await expect(first.authorizer.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "authorized",
    });
    await expect(first.authorizer.authorize(subject, installation)).resolves.toEqual({
      cacheHit: true,
      outcome: "authorized",
    });

    const otherProvider = {
      ...subject,
      githubProviderAccountId: "99900001",
    };
    await first.authorizer.authorize(otherProvider, installation);
    await first.authorizer.authorize(subject, { ...installation, installationId: 124_002 });
    const otherApp = createAuthorizer({
      appId: 999,
      cache,
      userCanAccessInstallation: accessCheck,
    });
    await otherApp.authorizer.authorize(subject, {
      ...installation,
      appId: 999,
      installationId: 999_001,
    });
    expect(accessCheck).toHaveBeenCalledTimes(4);

    nowMs += 60_000;
    await expect(first.authorizer.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "authorized",
    });
    expect(accessCheck).toHaveBeenCalledTimes(5);
  });

  it("uses the injected monotonic clock rather than wall-clock time for expiration", async () => {
    let monotonicMs = 10_000;
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const accessCheck = vi.fn(async () => true);
    const authorizer = createAuthorizer({
      now: () => monotonicMs,
      userCanAccessInstallation: accessCheck,
    }).authorizer;

    await authorizer.authorize(subject, installation);
    wallClock.mockReturnValue(-1_000_000);
    monotonicMs += 60_000;
    await authorizer.authorize(subject, installation);

    expect(accessCheck).toHaveBeenCalledTimes(2);
    wallClock.mockRestore();
  });

  it("provides a runtime clock that is independent of wall-clock rollback", () => {
    const wallClock = vi.spyOn(Date, "now").mockReturnValue(-1_000_000);

    expect(repositorySelectionAuthorizationMonotonicNow()).toBeGreaterThanOrEqual(0);

    wallClock.mockRestore();
  });

  it("never caches denial, missing evidence, provider failures, or rejected promises", async () => {
    const denialCheck = vi.fn(async () => false);
    const denied = createAuthorizer({ userCanAccessInstallation: denialCheck }).authorizer;
    await expect(denied.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "access-denied",
    });
    await denied.authorize(subject, installation);
    expect(denialCheck).toHaveBeenCalledTimes(2);

    const evidenceReader = vi.fn(async () => null);
    const missing = createAuthorizer({ readAccessEvidence: evidenceReader }).authorizer;
    await expect(missing.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "indeterminate",
    });
    await missing.authorize(subject, installation);
    expect(evidenceReader).toHaveBeenCalledTimes(2);

    let attempts = 0;
    const recovering = createAuthorizer({
      userCanAccessInstallation: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("provider token ghu_error_canary");
        return true;
      }),
    }).authorizer;
    await expect(recovering.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "indeterminate",
    });
    await expect(recovering.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "authorized",
    });
    expect(attempts).toBe(2);
  });

  it("coalesces concurrent misses without letting a rejected lookup poison later requests", async () => {
    let release: ((value: boolean) => void) | undefined;
    const lookup = vi.fn(
      async () =>
        await new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const authorizer = createAuthorizer({ userCanAccessInstallation: lookup }).authorizer;
    const first = authorizer.authorize(subject, installation);
    const second = authorizer.authorize(subject, installation);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    release?.(true);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { cacheHit: false, outcome: "authorized" },
      { cacheHit: false, outcome: "authorized" },
    ]);
  });

  it("fails closed before cache access when identity or same-App configuration is malformed", async () => {
    const accessCheck = vi.fn(async () => true);
    const invalidConfig = createAuthorizer({
      authGithubClientId: "different-client",
      userCanAccessInstallation: accessCheck,
    }).authorizer;

    await expect(invalidConfig.authorize(subject, installation)).resolves.toEqual({
      cacheHit: false,
      outcome: "indeterminate",
    });
    const valid = createAuthorizer({ userCanAccessInstallation: accessCheck }).authorizer;
    await expect(
      valid.authorize({ ...subject, githubProviderAccountId: "00022808397" }, installation),
    ).resolves.toEqual({ cacheHit: false, outcome: "indeterminate" });
    await expect(valid.authorize(subject, { ...installation, appId: 999 })).resolves.toEqual({
      cacheHit: false,
      outcome: "indeterminate",
    });
    expect(accessCheck).not.toHaveBeenCalled();
  });
});
