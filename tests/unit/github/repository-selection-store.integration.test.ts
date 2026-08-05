/** @vitest-environment node */

import { eq } from "drizzle-orm";
import { loopRuns, loops, repositories, vercelProjects } from "@/db/schema";
import {
  createGithubRepositorySelectionStore,
  type GithubRepositorySelectionDatabase,
} from "@/lib/github/repository-selection-store";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

const installationId = 125_001;
const now = new Date("2026-08-04T12:00:00.000Z");

describe("GitHub repository selection persistence", () => {
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

  function store() {
    return createGithubRepositorySelectionStore(
      context.db as unknown as GithubRepositorySelectionDatabase,
    );
  }

  function candidate(overrides: Partial<Parameters<ReturnType<typeof store>["select"]>[0]> = {}) {
    return {
      defaultBranch: "main",
      fullName: "loopworks-org/portal",
      githubRepoId: 900_001,
      installationId,
      name: "portal",
      now,
      owner: "loopworks-org",
      ...overrides,
    };
  }

  it("persists a selected repository with identity fields and schema defaults", async () => {
    await expect(store().select(candidate())).resolves.toBe("selected");

    const rows = await context.db.select().from(repositories);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      defaultBranch: "main",
      framework: "Unknown",
      fullName: "loopworks-org/portal",
      githubRepoId: 900_001,
      health: "healthy",
      installationId,
      isActive: true,
      lastSyncedAt: now,
      name: "portal",
      owner: "loopworks-org",
    });
    expect(rows[0]?.enabledLoops).toEqual([]);
  });

  it("is idempotent and refreshes identity for an already selected repository", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());

    await expect(
      selectionStore.select(
        candidate({
          defaultBranch: "trunk",
          fullName: "loopworks-org/portal-renamed",
          name: "portal-renamed",
          now: new Date("2026-08-04T13:00:00.000Z"),
        }),
      ),
    ).resolves.toBe("already-selected");

    const rows = await context.db.select().from(repositories);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      defaultBranch: "trunk",
      fullName: "loopworks-org/portal-renamed",
      lastSyncedAt: new Date("2026-08-04T13:00:00.000Z"),
      name: "portal-renamed",
    });
  });

  it("lists only the repositories selected for the given installation", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());
    await selectionStore.select(
      candidate({
        fullName: "other-org/service",
        githubRepoId: 900_002,
        installationId: 125_999,
        name: "service",
        owner: "other-org",
      }),
    );

    const selected = await selectionStore.listSelected(installationId);
    expect(selected.map((repository) => repository.githubRepoId)).toEqual([900_001]);
  });

  it("deselects a repository that has no loop or run history", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());

    await expect(selectionStore.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "deselected",
    );
    await expect(context.db.select().from(repositories)).resolves.toEqual([]);
  });

  it("reports a repository that was never selected", async () => {
    await expect(store().deselect({ githubRepoId: 404_404, installationId })).resolves.toBe(
      "not-selected",
    );
  });

  it("refuses to deselect a repository belonging to another installation", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate({ installationId: 125_999 }));

    await expect(selectionStore.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "not-selected",
    );
    await expect(context.db.select().from(repositories)).resolves.toHaveLength(1);
  });

  it("refuses to claim a repository already tracked by another installation", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate({ installationId: 125_999 }));

    await expect(selectionStore.select(candidate())).resolves.toBe("owned-by-other-installation");

    const rows = await context.db.select().from(repositories);
    expect(rows[0]?.installationId).toBe(125_999);
  });

  it("refuses to deselect a repository that still has a linked Vercel project", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());
    const [repository] = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, 900_001));
    if (!repository) throw new Error("expected the selected repository row");
    await context.db.insert(vercelProjects).values({
      projectId: "prj_portal",
      projectName: "portal",
      repositoryId: repository.id,
    });

    await expect(selectionStore.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "in-use",
    );
    await expect(context.db.select().from(vercelProjects)).resolves.toHaveLength(1);
  });

  it("reports a full-name collision instead of throwing an unhandled constraint error", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());

    // The repository was deleted and recreated on GitHub: same full name, new numeric id.
    await expect(selectionStore.select(candidate({ githubRepoId: 900_777 }))).resolves.toBe(
      "name-conflict",
    );
    await expect(context.db.select().from(repositories)).resolves.toHaveLength(1);
  });

  it("refuses to deselect a repository that still has loops, and deletes nothing", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());
    const [repository] = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, 900_001));
    if (!repository) throw new Error("expected the selected repository row");

    await context.db.insert(loops).values({
      githubIssueNumber: 125,
      repositoryId: repository.id,
      title: "Organization and repository selection into the catalog",
    });

    await expect(selectionStore.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "in-use",
    );
    await expect(context.db.select().from(repositories)).resolves.toHaveLength(1);
    await expect(context.db.select().from(loops)).resolves.toHaveLength(1);
  });

  it("refuses to deselect a repository that still has runs, and deletes nothing", async () => {
    const selectionStore = store();
    await selectionStore.select(candidate());
    const [repository] = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.githubRepoId, 900_001));
    if (!repository) throw new Error("expected the selected repository row");

    await context.db.insert(loopRuns).values({
      loopKey: "development",
      repositoryId: repository.id,
    });

    await expect(selectionStore.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "in-use",
    );
    await expect(context.db.select().from(repositories)).resolves.toHaveLength(1);
    await expect(context.db.select().from(loopRuns)).resolves.toHaveLength(1);
  });
});
