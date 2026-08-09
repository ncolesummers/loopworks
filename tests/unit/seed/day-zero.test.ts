/** @vitest-environment node */
import { githubInstallations, repositories } from "@/db/schema";
import {
  applyDayZeroInstallation,
  applyDayZeroRepository,
  buildDayZeroSeedData,
  dayZeroSeedIds,
} from "@/lib/seed/day-zero";
import { buildDemoSeedData, type SeedDatabase } from "@/lib/seed/demo-data";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("day-zero seed data (pglite integration)", () => {
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

  function testDatabase(): SeedDatabase {
    return context.db as unknown as SeedDatabase;
  }

  it("stages the installation without any repository, so the walk sees the repository step", async () => {
    const counts = await applyDayZeroInstallation(testDatabase());

    expect(counts).toEqual({ githubInstallations: 1, repositories: 0 });
    const installations = await context.db.select().from(githubInstallations);
    expect(installations).toHaveLength(1);
    expect(installations[0]?.installationId).toBe(dayZeroSeedIds.installationId);
    // The portal filters installations by the configured app id, so a mismatch would render the
    // installation stage as if no installation existed at all.
    expect(installations[0]?.appId).toBe(buildDayZeroSeedData().installation.appId);
    expect(await context.db.select().from(repositories)).toEqual([]);
  });

  it("stages the tracked repository against the staged installation", async () => {
    await applyDayZeroInstallation(testDatabase());
    const counts = await applyDayZeroRepository(testDatabase());

    expect(counts).toEqual({ githubInstallations: 1, repositories: 1 });
    const rows = await context.db.select().from(repositories);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(dayZeroSeedIds.repositoryId);
    expect(rows[0]?.installationId).toBe(dayZeroSeedIds.installationId);
    expect(rows[0]?.isActive).toBe(true);
  });

  it("re-applies a stage without duplicating rows", async () => {
    await applyDayZeroInstallation(testDatabase());
    await applyDayZeroRepository(testDatabase());
    await applyDayZeroRepository(testDatabase());

    expect(await context.db.select().from(githubInstallations)).toHaveLength(1);
    expect(await context.db.select().from(repositories)).toHaveLength(1);
  });

  it("uses ids the demo dataset does not, so neither lane can clear the other's rows by accident", () => {
    const demo = buildDemoSeedData();

    expect(demo.githubInstallations.map((row) => row.installationId)).not.toContain(
      dayZeroSeedIds.installationId,
    );
    expect(demo.repositories.map((row) => row.id)).not.toContain(dayZeroSeedIds.repositoryId);
    expect(demo.repositories.map((row) => row.githubRepoId)).not.toContain(
      buildDayZeroSeedData().repository.githubRepoId,
    );
  });
});
