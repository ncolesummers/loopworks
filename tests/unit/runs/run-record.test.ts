/** @vitest-environment node */
import { eq } from "drizzle-orm";

import { loopRuns } from "@/db/schema";
import { readRunRecords, getRunRecordsForResult } from "@/lib/runs/run-record";
import { buildRunFixtureRecords } from "@/lib/runs/fixtures";
import { demoSeedIds, seedDemoData, type SeedDatabase } from "@/lib/seed/demo-data";

import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

describe("run records (pglite integration)", () => {
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

  it("prioritizes waiting-for-approval and blocked runs for operator triage", async () => {
    await seedDemoData(testDatabase());

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.source).toBe("db");
    expect(result.runs.map((run) => run.status).slice(0, 2)).toEqual([
      "waiting_for_approval",
      "blocked",
    ]);

    const waiting = result.runs[0];
    expect(waiting.priorityLabel).toBe("Waiting approval");
    expect(waiting.approvals).toHaveLength(1);
    expect(waiting.approvals[0]).toMatchObject({
      scope: "deploy-preview",
      status: "requested",
      requestedBy: "morgan-dev",
    });

    const blocked = result.runs[1];
    expect(blocked.priorityLabel).toBe("Blocked");
    expect(blocked.blockedReason).toContain("missing Vercel scope grant");
  });

  it("returns a run detail with steps, validation evidence, artifacts, and safe external links", async () => {
    await seedDemoData(testDatabase());

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    const succeeded = result.runs.find((run) => run.status === "succeeded");

    expect(succeeded).toBeDefined();
    expect(succeeded?.repositoryFullName).toBe("ncolesummers/loopworks-web");
    expect(succeeded?.steps.map((step) => step.status)).toContain("succeeded");
    expect(succeeded?.steps.some((step) => step.validationCommand === "bun run validate")).toBe(
      true,
    );
    expect(succeeded?.artifacts.map((artifact) => artifact.label)).toEqual(
      expect.arrayContaining(["Applied patch", "PR intent", "Deployment summary"]),
    );
    expect(succeeded?.artifacts.every((artifact) => artifact.href.startsWith("https://"))).toBe(
      true,
    );
    expect(succeeded?.approvals.map((approval) => approval.status)).toEqual(
      expect.arrayContaining(["approved", "applied"]),
    );
  });

  it("orders same-priority runs by full queued timestamp across days", async () => {
    await seedDemoData(testDatabase());

    await context.db
      .update(loopRuns)
      .set({
        queuedAt: new Date("2026-06-29T23:00:00.000Z"),
        status: "failed",
      })
      .where(eq(loopRuns.id, demoSeedIds.loopRuns.failed));
    await context.db
      .update(loopRuns)
      .set({
        queuedAt: new Date("2026-06-30T08:00:00.000Z"),
        status: "failed",
      })
      .where(eq(loopRuns.id, demoSeedIds.loopRuns.succeeded));

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    const failedRunIds = result.runs.filter((run) => run.status === "failed").map((run) => run.id);

    expect(failedRunIds.indexOf(demoSeedIds.loopRuns.failed)).toBeLessThan(
      failedRunIds.indexOf(demoSeedIds.loopRuns.succeeded),
    );
  });

  it("keeps fixture fallback explicit and never returns fixtures for unavailable production data", () => {
    const fixtureRuns = buildRunFixtureRecords();

    expect(
      getRunRecordsForResult(
        {
          source: "fixtures",
          fallbackReason: "database_unavailable",
          runs: [],
          usedFallback: true,
        },
        fixtureRuns,
      ),
    ).toEqual(fixtureRuns);

    expect(
      getRunRecordsForResult(
        {
          error: "Run data store unavailable.",
          source: "unavailable",
          runs: [],
          usedFallback: false,
        },
        fixtureRuns,
      ),
    ).toEqual([]);
  });
});
