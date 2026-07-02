/** @vitest-environment node */
import { eq } from "drizzle-orm";

import {
  approvalStatusEnum,
  approvalTransitionEvents,
  approvals,
  artifacts,
  artifactTypeEnum,
  deploymentStatusEnum,
  deployments,
  loopRuns,
  loopStateEnum,
  loops,
  observabilityEvents,
  repoHealthEnum,
  repositories,
  runStatusEnum,
  runStepStatusEnum,
  runSteps,
  vercelProjects,
} from "@/db/schema";
import {
  buildDemoSeedData,
  demoSeedIds,
  type SeedDatabase,
  seedDemoData,
} from "@/lib/seed/demo-data";

import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

describe("demo seed data (pglite integration)", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  function testDatabase(): SeedDatabase {
    return context.db as unknown as SeedDatabase;
  }

  it("inserts the built demo dataset into every seeded table", async () => {
    const built = buildDemoSeedData();
    const counts = await seedDemoData(testDatabase());

    expect(counts).toEqual({
      repositories: built.repositories.length,
      vercelProjects: built.vercelProjects.length,
      loops: built.loops.length,
      loopRuns: built.loopRuns.length,
      runSteps: built.runSteps.length,
      artifacts: built.artifacts.length,
      approvals: built.approvals.length,
      approvalTransitionEvents: built.approvalTransitionEvents.length,
      deployments: built.deployments.length,
    });

    const repoRows = await context.db.select().from(repositories);
    const vercelProjectRows = await context.db.select().from(vercelProjects);
    const loopRows = await context.db.select().from(loops);
    const runRows = await context.db.select().from(loopRuns);
    const stepRows = await context.db.select().from(runSteps);
    const artifactRows = await context.db.select().from(artifacts);
    const approvalRows = await context.db.select().from(approvals);
    const approvalTransitionRows = await context.db.select().from(approvalTransitionEvents);
    const deploymentRows = await context.db.select().from(deployments);

    expect(repoRows).toHaveLength(built.repositories.length);
    expect(vercelProjectRows).toHaveLength(built.vercelProjects.length);
    expect(loopRows).toHaveLength(built.loops.length);
    expect(runRows).toHaveLength(built.loopRuns.length);
    expect(stepRows).toHaveLength(built.runSteps.length);
    expect(artifactRows).toHaveLength(built.artifacts.length);
    expect(approvalRows).toHaveLength(built.approvals.length);
    expect(approvalTransitionRows).toHaveLength(built.approvalTransitionEvents.length);
    expect(deploymentRows).toHaveLength(built.deployments.length);
  });

  it("is idempotent: seeding twice does not duplicate rows", async () => {
    await seedDemoData(testDatabase());
    await seedDemoData(testDatabase());

    const built = buildDemoSeedData();
    const repoRows = await context.db.select().from(repositories);
    const loopRows = await context.db.select().from(loops);
    const runRows = await context.db.select().from(loopRuns);
    const approvalRows = await context.db.select().from(approvals);
    const approvalTransitionRows = await context.db.select().from(approvalTransitionEvents);
    const deploymentRows = await context.db.select().from(deployments);

    expect(repoRows).toHaveLength(built.repositories.length);
    expect(loopRows).toHaveLength(built.loops.length);
    expect(runRows).toHaveLength(built.loopRuns.length);
    expect(approvalRows).toHaveLength(built.approvals.length);
    expect(approvalTransitionRows).toHaveLength(built.approvalTransitionEvents.length);
    expect(deploymentRows).toHaveLength(built.deployments.length);
  });

  it("reset clears and reinserts a clean dataset", async () => {
    await seedDemoData(testDatabase());
    const counts = await seedDemoData(testDatabase(), { reset: true });

    const built = buildDemoSeedData();
    expect(counts.repositories).toBe(built.repositories.length);

    const repoRows = await context.db.select().from(repositories);
    expect(repoRows).toHaveLength(built.repositories.length);
  });

  it("reset only clears the fixed demo rows it owns, not unrelated rows in the same tables", async () => {
    await seedDemoData(testDatabase());

    await context.db.insert(repositories).values({
      githubRepoId: 1,
      owner: "someone-else",
      name: "unrelated-repo",
      fullName: "someone-else/unrelated-repo",
    });
    await context.db.insert(observabilityEvents).values({
      eventType: "manual_test_event",
    });

    await seedDemoData(testDatabase(), { reset: true });

    const repoRows = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.fullName, "someone-else/unrelated-repo"));
    expect(repoRows).toHaveLength(1);

    const observabilityRows = await context.db
      .select()
      .from(observabilityEvents)
      .where(eq(observabilityEvents.eventType, "manual_test_event"));
    expect(observabilityRows).toHaveLength(1);

    const built = buildDemoSeedData();
    const allRepoRows = await context.db.select().from(repositories);
    expect(allRepoRows).toHaveLength(built.repositories.length + 1);
  });

  it("is idempotent: reseeding without reset overwrites a manually-edited demo row back to the built value", async () => {
    await seedDemoData(testDatabase());

    await context.db
      .update(repositories)
      .set({ health: "blocked" })
      .where(eq(repositories.id, demoSeedIds.repositories.loopworksWeb));

    await seedDemoData(testDatabase());

    const [repoRow] = await context.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, demoSeedIds.repositories.loopworksWeb));
    expect(repoRow?.health).toBe("healthy");
  });

  it("seeds foreign keys pointing at the intended related rows, not just any valid row", async () => {
    await seedDemoData(testDatabase());

    const [waitingForApprovalRun] = await context.db
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.id, demoSeedIds.loopRuns.waitingForApproval));
    expect(waitingForApprovalRun?.repositoryId).toBe(demoSeedIds.repositories.factoryCore);

    const [requestedApproval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, demoSeedIds.approvals.requested));
    expect(requestedApproval?.loopId).toBe(demoSeedIds.loops.waitingOnReview);
    expect(requestedApproval?.runId).toBe(demoSeedIds.loopRuns.waitingForApproval);
  });

  it("covers every repo health, loop, run, run step, artifact, approval, and deployment status value across both deployment environments", async () => {
    await seedDemoData(testDatabase());

    const repoRows = await context.db.select().from(repositories);
    const loopRows = await context.db.select().from(loops);
    const runRows = await context.db.select().from(loopRuns);
    const stepRows = await context.db.select().from(runSteps);
    const artifactRows = await context.db.select().from(artifacts);
    const approvalRows = await context.db.select().from(approvals);
    const deploymentRows = await context.db.select().from(deployments);

    for (const value of repoHealthEnum.enumValues) {
      expect(repoRows.some((row) => row.health === value)).toBe(true);
    }
    for (const value of loopStateEnum.enumValues) {
      expect(loopRows.some((row) => row.state === value)).toBe(true);
    }
    for (const value of runStatusEnum.enumValues) {
      expect(runRows.some((row) => row.status === value)).toBe(true);
    }
    for (const value of runStepStatusEnum.enumValues) {
      expect(stepRows.some((row) => row.status === value)).toBe(true);
    }
    for (const value of artifactTypeEnum.enumValues) {
      expect(artifactRows.some((row) => row.type === value)).toBe(true);
    }
    for (const value of approvalStatusEnum.enumValues) {
      expect(approvalRows.some((row) => row.status === value)).toBe(true);
    }
    for (const value of deploymentStatusEnum.enumValues) {
      expect(deploymentRows.some((row) => row.status === value)).toBe(true);
    }

    expect(deploymentRows.some((row) => row.environment === "production")).toBe(true);
    expect(deploymentRows.some((row) => row.environment === "preview")).toBe(true);
    expect(repoRows.some((row) => row.isActive === false)).toBe(true);
  });

  it("seeds approval transition audit rows with actor attribution", async () => {
    await seedDemoData(testDatabase());

    const built = buildDemoSeedData();
    const transitionRows = await context.db.select().from(approvalTransitionEvents);
    const resolvedApprovals = built.approvals.filter((approval) => approval.resolvedAt);

    expect(transitionRows).toHaveLength(built.approvalTransitionEvents.length);
    expect(transitionRows.map((row) => row.approvalId).sort()).toEqual(
      resolvedApprovals.map((approval) => approval.id).sort(),
    );
    expect(resolvedApprovals.every((approval) => approval.resolvedBy)).toBe(true);
    expect(transitionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "bypass",
          actorId: "priya-sec",
          fromStatus: "requested",
          toStatus: "bypassed",
        }),
      ]),
    );
  });

  it("never seeds secret-looking values", () => {
    const built = buildDemoSeedData();
    const serialized = JSON.stringify(built).toLowerCase();

    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("ghs_");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
  });
});
