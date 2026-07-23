/** @vitest-environment node */
import { and, eq } from "drizzle-orm";

import { loopRuns, observabilityEvents, repositories, runSteps } from "@/db/schema";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  createDevelopmentLoopRunStore,
  type DevelopmentLoopReconciliationDatabase,
} from "@/lib/loops/development-run-reconciliation-store";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const trigger = {
  body: "## Acceptance Criteria\n- Reconcile runs deterministically.",
  deliveryId: "issue-95-reconcile",
  issueNumber: 95,
  issueUrl: "https://github.com/ncolesummers/loopworks/issues/95",
  labels: ["agent-ready", "area:loops"],
  milestone: "M3 Durable Loop MVP",
  repositoryFullName: "ncolesummers/loopworks",
  title: "Run reconciliation",
};

function runDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

describe("development-loop reconciliation store", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("lists active runs with latest step activity and delegates finalization", async () => {
    const [repository] = await context.db
      .insert(repositories)
      .values({
        githubRepoId: 95_000_001,
        installationId: 95_001,
        owner: "ncolesummers",
        name: "loopworks",
        fullName: "ncolesummers/loopworks",
      })
      .returning();
    if (!repository) throw new Error("Expected repository fixture.");
    const created = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-22T16:00:00.000Z"),
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      trigger,
    });
    if (created.mode !== "created") throw new Error("Expected a created run.");
    await context.db
      .update(loopRuns)
      .set({ status: "running" })
      .where(eq(loopRuns.id, created.runId));
    await context.db.insert(loopRuns).values({
      githubIssueNumber: 43,
      loopKey: "research-loop",
      repositoryId: repository.id,
      status: "running",
    });

    const metrics = { runCompleted: vi.fn(), runDuration: vi.fn() };
    const store = createDevelopmentLoopRunStore({
      database: context.db as unknown as DevelopmentLoopReconciliationDatabase,
      executionLiveness: async () => "active",
      metrics,
    });
    const planning = await store.listActiveRuns();

    expect(planning).toEqual([
      expect.objectContaining({
        currentStage: "planning",
        latestStepActivityAt: new Date("2026-07-22T16:00:00.000Z"),
        runId: created.runId,
      }),
    ]);
    await context.db
      .update(loopRuns)
      .set({ currentStage: "development" })
      .where(eq(loopRuns.id, created.runId));
    await context.db
      .update(runSteps)
      .set({ startedAt: new Date("2026-07-22T16:07:00.000Z") })
      .where(and(eq(runSteps.runId, created.runId), eq(runSteps.stage, "development")));
    const active = await store.listActiveRuns();

    expect(active).toEqual([
      expect.objectContaining({
        currentStepId: expect.any(String),
        installationId: 95_001,
        latestStepActivityAt: new Date("2026-07-22T16:07:00.000Z"),
        runId: created.runId,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      }),
    ]);
    await store.finalizeRun({
      occurredAt: new Date("2026-07-22T16:10:00.000Z"),
      reason: "stalled",
      runId: created.runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, created.runId));
    const completionEvents = await context.db
      .select()
      .from(observabilityEvents)
      .where(eq(observabilityEvents.eventType, "development_loop_run_completed"));
    expect(run).toMatchObject({ status: "failed", terminalReason: "stalled" });
    expect(completionEvents).toHaveLength(1);
    expect(metrics.runCompleted).toHaveBeenCalledTimes(1);
    expect(await store.listActiveRuns()).toEqual([]);
  });

  it("rejects finalization when current-step activity changed after the snapshot", async () => {
    await context.db.insert(repositories).values({
      githubRepoId: 95_000_002,
      installationId: 95_002,
      owner: "ncolesummers",
      name: "loopworks-race",
      fullName: "ncolesummers/loopworks-race",
    });
    const created = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-22T16:00:00.000Z"),
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      trigger: {
        ...trigger,
        deliveryId: "issue-95-race",
        repositoryFullName: "ncolesummers/loopworks-race",
      },
    });
    if (created.mode !== "created") throw new Error("Expected a created run.");
    await context.db
      .update(loopRuns)
      .set({ status: "running" })
      .where(eq(loopRuns.id, created.runId));
    const store = createDevelopmentLoopRunStore({
      database: context.db as unknown as DevelopmentLoopReconciliationDatabase,
      executionLiveness: async () => "active",
    });
    const [snapshot] = await store.listActiveRuns();
    if (!snapshot) throw new Error("Expected active run snapshot.");
    await context.db
      .update(runSteps)
      .set({ startedAt: new Date("2026-07-22T16:09:00.000Z") })
      .where(and(eq(runSteps.runId, created.runId), eq(runSteps.stage, "planning")));

    await expect(
      store.finalizeRun({
        expected: {
          currentStage: snapshot.currentStage,
          currentStepId: snapshot.currentStepId,
          latestStepActivityAt: snapshot.latestStepActivityAt,
        },
        occurredAt: new Date("2026-07-22T16:10:00.000Z"),
        reason: "stalled",
        runId: created.runId,
      }),
    ).resolves.toEqual({ finalized: false, reason: "state_changed", runId: created.runId });
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, created.runId));
    expect(run).toMatchObject({ status: "running", terminalReason: null });
  });
});
