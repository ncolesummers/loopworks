/** @vitest-environment node */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loopDefinitions, repositories } from "@/db/schema";
import { defaultLoopManifest } from "@/lib/loops/manifest";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

const definition = defaultLoopManifest.loops[0];

if (!definition) throw new Error("defaultLoopManifest has no loops");

describe("loop_definitions persistence contract", () => {
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

  async function insertRepository() {
    const [repository] = await context.db
      .insert(repositories)
      .values({
        fullName: "loopworks-org/portal",
        githubRepoId: 900_001,
        name: "portal",
        owner: "loopworks-org",
      })
      .returning();

    if (!repository) throw new Error("repository insert returned no row");
    return repository;
  }

  it("stores a definition as jsonb with enabled defaulting to true", async () => {
    const repository = await insertRepository();

    await context.db.insert(loopDefinitions).values({
      definition,
      loopKey: definition.key,
      repositoryId: repository.id,
    });

    const rows = await context.db.select().from(loopDefinitions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(true);
    // The whole validated contract round-trips, not a lossy column projection of it.
    expect(rows[0]?.definition).toEqual(definition);
  });

  it("rejects a second definition with the same key on the same repository", async () => {
    const repository = await insertRepository();
    const row = {
      definition,
      loopKey: definition.key,
      repositoryId: repository.id,
    };

    await context.db.insert(loopDefinitions).values(row);

    await expect(context.db.insert(loopDefinitions).values(row)).rejects.toThrow();
  });

  it("removes definitions when the repository row is deleted", async () => {
    const repository = await insertRepository();
    await context.db.insert(loopDefinitions).values({
      definition,
      loopKey: definition.key,
      repositoryId: repository.id,
    });

    await context.db.delete(repositories);

    await expect(context.db.select().from(loopDefinitions)).resolves.toEqual([]);
  });
});
