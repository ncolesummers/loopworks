/** @vitest-environment node */

import { eq } from "drizzle-orm";
import { githubInstallations, loops, repositories } from "@/db/schema";
import type { AvailableGithubRepository } from "@/lib/github/installation-flow";
import { createGithubRepositorySelectionFlow } from "@/lib/github/repository-selection";
import {
  createGithubRepositorySelectionStore,
  type GithubRepositorySelectionDatabase,
} from "@/lib/github/repository-selection-store";
import { deriveFirstRunState } from "@/lib/onboarding/first-run-state";
import { type PortalRecordsDatabase, readPortalRecords } from "@/lib/portal/records";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

const appId = 124;
const installationId = 124_001;
const now = new Date("2026-08-04T12:00:00.000Z");
const subject = {
  authUserId: "auth-user-operator",
  githubProviderAccountId: "22808397",
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

describe("repository selection reaching the catalog", () => {
  let context: PgliteTestDatabase;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
    await context.db.insert(githubInstallations).values({
      accountId: 12_400,
      accountLogin: "loopworks-org",
      accountType: "Organization",
      appId,
      installationId,
      installedBy: "ncolesummers",
      repositorySelection: "selected",
    });
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  function flow(available: AvailableGithubRepository[] = [portal]) {
    return createGithubRepositorySelectionFlow({
      authorizeInstallationAccess: async () => ({ cacheHit: false, outcome: "authorized" }),
      gateway: { listInstallationRepositories: async () => available },
      now: () => now,
      store: createGithubRepositorySelectionStore(
        context.db as unknown as GithubRepositorySelectionDatabase,
        { appId },
      ),
    });
  }

  async function firstRunState() {
    return deriveFirstRunState({
      result: await readPortalRecords({
        database: context.db as unknown as PortalRecordsDatabase,
        githubAppId: appId,
        now,
      }),
    });
  }

  it("moves the operator off no-repositories and into the catalog when a repo is selected", async () => {
    await expect(firstRunState()).resolves.toEqual({
      stage: "no-repositories",
      status: "onboarding",
    });

    await expect(
      flow().applySelection(subject, { deselect: [], select: [portal.githubRepoId] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "selected" }],
      status: "applied",
    });

    const result = await readPortalRecords({
      database: context.db as unknown as PortalRecordsDatabase,
      githubAppId: appId,
      now,
    });
    expect(result.records.repos).toHaveLength(1);
    expect(result.records.repos[0]).toMatchObject({
      lastSynced: "just now",
      name: "portal",
      owner: "loopworks-org",
    });
    expect(deriveFirstRunState({ result })).toEqual({ stage: "no-loops", status: "onboarding" });
  });

  it("returns the operator to no-repositories when the last selection is removed", async () => {
    const selection = flow();
    await selection.applySelection(subject, { deselect: [], select: [portal.githubRepoId] });

    await expect(
      selection.applySelection(subject, { deselect: [portal.githubRepoId], select: [] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "deselected" }],
      status: "applied",
    });

    const result = await readPortalRecords({
      database: context.db as unknown as PortalRecordsDatabase,
      githubAppId: appId,
      now,
    });
    expect(result.records.repos).toEqual([]);
    expect(deriveFirstRunState({ result })).toEqual({
      stage: "no-repositories",
      status: "onboarding",
    });
  });

  it("keeps a repository in the catalog when deselection is refused for loop history", async () => {
    const selection = flow();
    await selection.applySelection(subject, { deselect: [], select: [portal.githubRepoId] });
    const [repository] = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, portal.githubRepoId));
    if (!repository) throw new Error("expected the selected repository row");
    await context.db.insert(loops).values({
      githubIssueNumber: 125,
      repositoryId: repository.id,
      title: "Organization and repository selection into the catalog",
    });

    await expect(
      selection.applySelection(subject, { deselect: [portal.githubRepoId], select: [] }),
    ).resolves.toEqual({
      outcomes: [{ githubRepoId: portal.githubRepoId, outcome: "in-use" }],
      status: "applied",
    });
    await expect(context.db.select().from(repositories)).resolves.toHaveLength(1);
  });

  it("reports zero accessible repositories as its own state, not as not-connected", async () => {
    await expect(flow([]).readSelection(subject)).resolves.toMatchObject({
      installation: { accountLogin: "loopworks-org", installationId },
      repositories: [],
      status: "no-accessible-repositories",
    });
  });

  it("ignores an installation that belongs to a different GitHub App", async () => {
    await context.db
      .update(githubInstallations)
      .set({ appId: 999 })
      .where(eq(githubInstallations.installationId, installationId));

    await expect(flow().readSelection(subject)).resolves.toEqual({ status: "not-connected" });
  });
});
