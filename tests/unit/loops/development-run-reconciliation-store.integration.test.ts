/** @vitest-environment node */
import { and, eq } from "drizzle-orm";

import {
  idempotencyLocks,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  createDevelopmentLoopRunStore,
  type DevelopmentLoopReconciliationDatabase,
} from "@/lib/loops/development-run-reconciliation-store";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

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

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

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
    if (created.mode !== "dispatched") throw new Error("Expected a dispatched run.");
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
    if (created.mode !== "dispatched") throw new Error("Expected a dispatched run.");
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

  it("uses the durable run lease as the default execution-liveness authority", async () => {
    await context.db.insert(repositories).values({
      githubRepoId: 95_000_003,
      installationId: 95_003,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
    });
    const created = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-22T16:00:00.000Z"),
      trigger: { ...trigger, deliveryId: "lease-liveness" },
    });
    if (created.mode !== "dispatched") throw new Error("Expected a dispatched run.");
    await context.db
      .update(loopRuns)
      .set({ status: "running" })
      .where(eq(loopRuns.id, created.runId));
    const activeStore = createDevelopmentLoopRunStore({
      clock: () => new Date("2026-07-22T16:01:00.000Z"),
      database: context.db as unknown as DevelopmentLoopReconciliationDatabase,
    });
    const [run] = await activeStore.listActiveRuns();
    if (!run) throw new Error("Expected active run.");
    await expect(activeStore.getExecutionLiveness(run)).resolves.toBe("active");

    const expiredStore = createDevelopmentLoopRunStore({
      clock: () => new Date("2026-07-22T17:31:00.000Z"),
      database: context.db as unknown as DevelopmentLoopReconciliationDatabase,
    });
    await expect(expiredStore.getExecutionLiveness(run)).resolves.toBe("inactive");
    await context.db
      .update(idempotencyLocks)
      .set({ status: "released" })
      .where(eq(idempotencyLocks.runId, created.runId));
    await expect(activeStore.getExecutionLiveness(run)).resolves.toBe("inactive");

    await context.db.delete(idempotencyLocks).where(eq(idempotencyLocks.runId, created.runId));
    await expect(activeStore.getExecutionLiveness(run)).resolves.toBe("unknown");
  });

  it("includes an expired queued lease owner for reconciliation but excludes deferred queued work", async () => {
    await context.db.insert(repositories).values({
      githubRepoId: 95_000_004,
      installationId: 95_004,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
    });
    const leased = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-22T16:00:00.000Z"),
      trigger: { ...trigger, deliveryId: "queued-lease-owner" },
    });
    const deferred = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-22T16:00:01.000Z"),
      trigger: { ...trigger, deliveryId: "queued-deferred", issueNumber: 96 },
    });
    expect(leased.mode).toBe("dispatched");
    expect(deferred.mode).toBe("deferred");

    const store = createDevelopmentLoopRunStore({
      clock: () => new Date("2026-07-22T17:31:00.000Z"),
      database: context.db as unknown as DevelopmentLoopReconciliationDatabase,
    });
    expect((await store.listActiveRuns()).map(({ runId }) => runId)).toEqual([leased.runId]);
  });
});
