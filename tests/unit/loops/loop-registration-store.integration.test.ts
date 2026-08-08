/** @vitest-environment node */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loopDefinitions, repositories } from "@/db/schema";
import {
  createGithubRepositorySelectionStore,
  type GithubRepositorySelectionDatabase,
} from "@/lib/github/repository-selection-store";
import { validateLoopRegistration } from "@/lib/loops/loop-registration";
import {
  createLoopDefinitionStore,
  type LoopDefinitionDatabase,
} from "@/lib/loops/loop-registration-store";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

const installationId = 5_000_001;
const now = new Date("2026-08-08T12:00:00.000Z");

function definitionFor(fullName: string, key = "development-loop") {
  const result = validateLoopRegistration({
    defaultBranch: "main",
    enabled: true,
    issueLabels: ["agent-ready"],
    key,
    name: "Agent-ready development loop",
    repositoryFullName: fullName,
  });

  if (!result.success) throw new Error("fixture definition failed validation");
  return result.definition;
}

describe("loop definition persistence", () => {
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
    return createLoopDefinitionStore(context.db as unknown as LoopDefinitionDatabase);
  }

  async function trackRepository(
    overrides: Partial<typeof repositories.$inferInsert> = {},
  ): Promise<typeof repositories.$inferSelect> {
    const [row] = await context.db
      .insert(repositories)
      .values({
        defaultBranch: "main",
        fullName: "loopworks-org/portal",
        githubRepoId: 900_001,
        installationId,
        name: "portal",
        owner: "loopworks-org",
        ...overrides,
      })
      .returning();

    if (!row) throw new Error("repository insert returned no row");
    return row;
  }

  it("lists tracked repositories in a stable order for the registration surface", async () => {
    await trackRepository({
      fullName: "loopworks-org/web",
      githubRepoId: 900_003,
      name: "web",
    });
    await trackRepository();

    await expect(store().listTrackedRepositories()).resolves.toEqual([
      {
        defaultBranch: "main",
        fullName: "loopworks-org/portal",
        id: expect.any(String),
        name: "portal",
        owner: "loopworks-org",
      },
      {
        defaultBranch: "main",
        fullName: "loopworks-org/web",
        id: expect.any(String),
        name: "web",
        owner: "loopworks-org",
      },
    ]);
  });

  it("registers a definition and reports it back with its repository", async () => {
    const repository = await trackRepository();
    const definition = definitionFor("loopworks-org/portal");

    await expect(store().register({ definition, now, repositoryId: repository.id })).resolves.toBe(
      "registered",
    );

    const rows = await context.db.select().from(loopDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      enabled: true,
      loopKey: "development-loop",
      repositoryId: repository.id,
    });
    expect(rows[0]?.definition).toEqual(definition);

    await expect(store().listRegistered()).resolves.toEqual([
      {
        definition,
        enabled: true,
        loopKey: "development-loop",
        repositoryFullName: "loopworks-org/portal",
      },
    ]);
  });

  it("persists the disabled state the operator chose rather than the column default", async () => {
    const repository = await trackRepository();
    const definition = { ...definitionFor("loopworks-org/portal"), enabled: false };

    await expect(store().register({ definition, now, repositoryId: repository.id })).resolves.toBe(
      "registered",
    );

    const [row] = await context.db.select().from(loopDefinitions);
    expect(row?.enabled).toBe(false);
  });

  it("refuses a duplicate key on the same repository without overwriting the first", async () => {
    const repository = await trackRepository();
    const first = definitionFor("loopworks-org/portal");

    await store().register({ definition: first, now, repositoryId: repository.id });
    await expect(
      store().register({
        definition: { ...first, name: "Replacement" },
        now,
        repositoryId: repository.id,
      }),
    ).resolves.toBe("duplicate-key");

    const rows = await context.db.select().from(loopDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.definition.name).toBe(first.name);
  });

  it("allows the same key on a different repository", async () => {
    const portal = await trackRepository();
    const web = await trackRepository({
      fullName: "loopworks-org/web",
      githubRepoId: 900_003,
      name: "web",
    });

    await store().register({
      definition: definitionFor("loopworks-org/portal"),
      now,
      repositoryId: portal.id,
    });
    await expect(
      store().register({
        definition: definitionFor("loopworks-org/web"),
        now,
        repositoryId: web.id,
      }),
    ).resolves.toBe("registered");

    await expect(context.db.select().from(loopDefinitions)).resolves.toHaveLength(2);
  });

  it("reports a missing repository instead of raising a foreign-key error", async () => {
    await expect(
      store().register({
        definition: definitionFor("loopworks-org/portal"),
        now,
        repositoryId: "00000000-0000-4000-8000-000000000000",
      }),
    ).resolves.toBe("repository-missing");
  });

  it("refuses to deselect a repository that still has a registered loop", async () => {
    const repository = await trackRepository();
    await store().register({
      definition: definitionFor("loopworks-org/portal"),
      now,
      repositoryId: repository.id,
    });

    const selection = createGithubRepositorySelectionStore(
      context.db as unknown as GithubRepositorySelectionDatabase,
    );

    // Without the guard the cascade would silently destroy the registered contract.
    await expect(selection.deselect({ githubRepoId: 900_001, installationId })).resolves.toBe(
      "in-use",
    );
    await expect(
      context.db.select().from(repositories).where(eq(repositories.id, repository.id)),
    ).resolves.toHaveLength(1);
    await expect(context.db.select().from(loopDefinitions)).resolves.toHaveLength(1);
  });
});
