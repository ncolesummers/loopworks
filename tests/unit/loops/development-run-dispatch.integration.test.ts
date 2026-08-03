/** @vitest-environment node */

import { and, eq } from "drizzle-orm";

import { idempotencyLocks, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  createDevelopmentLoopRun,
  dispatchDevelopmentLoopRun,
  drainDevelopmentLoopDispatchQueue,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  finalizeDevelopmentLoopRun,
  retryDevelopmentLoopStep,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createResearchLoopRun } from "@/lib/loops/research-run";
import type { LoopManifest } from "../../../schemas/loop-manifest";
import {
  createPgliteTestDatabase,
  pgliteTestHookTimeoutMs,
  type PgliteTestDatabase,
} from "../../helpers/pglite";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

function runDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

function transitionDatabase(context: PgliteTestDatabase): DevelopmentLoopTransitionDatabase {
  return context.db as unknown as DevelopmentLoopTransitionDatabase;
}

function manifestWith(input: { group?: string; maxInFlight: number }): LoopManifest {
  return {
    ...defaultLoopManifest,
    loops: defaultLoopManifest.loops.map((loop) =>
      loop.key === "development-loop"
        ? {
            ...loop,
            concurrency: {
              ...loop.concurrency,
              group: input.group ?? loop.concurrency.group,
              maxInFlight: input.maxInFlight,
            },
          }
        : loop,
    ),
  };
}

function trigger(issueNumber: number, deliveryId = `issue-${issueNumber}-delivery`) {
  return {
    body: `## Acceptance Criteria\n- Dispatch issue ${issueNumber} durably.`,
    deliveryId,
    issueNumber,
    issueUrl: `https://github.com/ncolesummers/loopworks/issues/${issueNumber}`,
    labels: ["agent-ready", "area:loops"],
    milestone: "M3 Durable Loop MVP",
    repositoryFullName: "ncolesummers/loopworks",
    title: `Issue ${issueNumber}`,
  };
}

async function insertRepository(context: PgliteTestDatabase) {
  await context.db.insert(repositories).values({
    githubRepoId: 96_000_001,
    owner: "ncolesummers",
    name: "loopworks",
    fullName: "ncolesummers/loopworks",
  });
}

describe("development-loop dispatch admission", () => {
  let context: PgliteTestDatabase;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
    await insertRepository(context);
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  it("defers over-cap work and leases it after the in-flight run terminates", async () => {
    const manifest = manifestWith({ maxInFlight: 1 });
    const first = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest,
      traceId,
      trigger: trigger(96),
    });
    const second = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest,
      traceId,
      trigger: trigger(97),
    });

    expect(first).toMatchObject({ mode: "dispatched" });
    expect(second).toMatchObject({ mode: "deferred", reason: "max_in_flight" });
    expect(await context.db.select().from(loopRuns)).toHaveLength(2);
    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.status, "acquired")),
    ).toEqual([
      expect.objectContaining({
        owner: first.runId,
        runId: first.runId,
        scope: "repo:ncolesummers/loopworks:loop:development",
        traceId,
      }),
    ]);

    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      reason: "succeeded",
      runId: first.runId,
    });

    const acquired = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.status, "acquired"));
    expect(acquired).toEqual([
      expect.objectContaining({ owner: second.runId, runId: second.runId }),
    ]);
  });

  it("allows exactly one concurrent run for the same issue across delivery ids", async () => {
    const manifest = manifestWith({ maxInFlight: 2 });
    const outcomes = await Promise.all([
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T16:00:00.000Z"),
        database: runDatabase(context),
        manifest,
        traceId,
        trigger: trigger(96, "delivery-a"),
      }),
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T16:00:00.000Z"),
        database: runDatabase(context),
        manifest,
        traceId,
        trigger: trigger(96, "delivery-b"),
      }),
    ]);

    expect(outcomes.filter(({ mode }) => mode === "dispatched")).toHaveLength(1);
    expect(outcomes.filter(({ mode }) => mode === "lease_contention")).toHaveLength(1);
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.status, "acquired")),
    ).toHaveLength(1);
  });

  it("changes capacity and isolation when manifest values change", async () => {
    const capTwo = manifestWith({ maxInFlight: 2 });
    const first = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: capTwo,
      trigger: trigger(96),
    });
    const second = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest: capTwo,
      trigger: trigger(97),
    });

    expect(first.mode).toBe("dispatched");
    expect(second.mode).toBe("dispatched");

    const isolated = manifestWith({
      group: "repo:{repo}:loop:development:isolated",
      maxInFlight: 1,
    });
    const third = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:02.000Z"),
      database: runDatabase(context),
      manifest: isolated,
      trigger: trigger(98),
    });
    expect(third.mode).toBe("dispatched");
  });

  it("keeps expired but unreconciled leases in capacity and rejects unknown placeholders", async () => {
    const manifest = manifestWith({ maxInFlight: 1 });
    await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest,
      trigger: trigger(96),
    });
    await expect(
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T18:00:00.000Z"),
        database: runDatabase(context),
        manifest,
        trigger: trigger(97),
      }),
    ).resolves.toMatchObject({ mode: "deferred", reason: "max_in_flight" });

    await expect(
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T18:00:00.000Z"),
        database: runDatabase(context),
        manifest: manifestWith({ group: "repo:{repo}:loop:{unknown}", maxInFlight: 1 }),
        trigger: trigger(98),
      }),
    ).rejects.toThrow("Unsupported concurrency group placeholder: {unknown}");
  });

  it("promotes only due queued retries and preserves the stored trace", async () => {
    const manifest = manifestWith({ maxInFlight: 1 });
    const first = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest,
      traceId,
      trigger: trigger(96),
    });
    const deferred = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest,
      traceId,
      trigger: trigger(97),
    });
    if (first.mode !== "dispatched" || deferred.mode !== "deferred") {
      throw new Error("Expected one dispatched and one deferred run.");
    }
    await context.db
      .update(loopRuns)
      .set({ queuedAt: new Date("2026-07-24T16:10:00.000Z") })
      .where(eq(loopRuns.id, deferred.runId));
    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      reason: "succeeded",
      runId: first.runId,
    });

    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(
          and(eq(idempotencyLocks.runId, deferred.runId), eq(idempotencyLocks.status, "acquired")),
        ),
    ).toEqual([]);

    const promoted = await drainDevelopmentLoopDispatchQueue({
      clock: () => new Date("2026-07-24T16:10:00.000Z"),
      database: runDatabase(context),
      manifest,
    });
    expect(promoted).toEqual([
      expect.objectContaining({ mode: "dispatched", runId: deferred.runId, traceId }),
    ]);
    const steps = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, deferred.runId));
    expect(steps.every((step) => step.traceId === traceId)).toBe(true);
  });

  it("preserves admission outcomes through the persistent compatibility entry point", async () => {
    const first = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-24T16:00:00.000Z"),
      trigger: trigger(96),
    });
    const second = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-24T16:00:01.000Z"),
      trigger: trigger(97),
    });

    expect(first.mode).toBe("dispatched");
    expect(second).toMatchObject({ mode: "deferred", reason: "max_in_flight" });
  });

  it("refuses stage mutation for a deferred run without an execution lease", async () => {
    await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(96),
    });
    const deferred = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(97),
    });
    const [planning] = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, deferred.runId));
    await context.db.update(runSteps).set({ status: "failed" }).where(eq(runSteps.id, planning.id));
    await context.db
      .update(loopRuns)
      .set({ status: "failed" })
      .where(eq(loopRuns.id, deferred.runId));

    await expect(
      retryDevelopmentLoopStep({
        database: transitionDatabase(context),
        reason: "operator_retry",
        runId: deferred.runId,
        stage: planning.stage,
      }),
    ).rejects.toThrow("does not own an acquired execution lease");
  });

  it("enforces cross-loop issue exclusivity without surfacing a unique violation", async () => {
    const development = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(96),
    });
    const research = await createResearchLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-24T16:00:01.000Z"),
      trigger: trigger(96, "research-delivery"),
    });

    expect(research).toMatchObject({ mode: "lease_contention", runId: development.runId });
    const researchFirst = await createResearchLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-24T16:00:02.000Z"),
      trigger: trigger(97, "research-first"),
    });
    expect(researchFirst.mode).toBe("created");
    if (researchFirst.mode !== "created") throw new Error("Expected a research run.");
    const developmentSecond = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:03.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(97, "development-second"),
    });
    expect(developmentSecond).toMatchObject({
      mode: "lease_contention",
      runId: researchFirst.runId,
    });
    expect(await context.db.select().from(loopRuns)).toHaveLength(2);
  });

  it("does not emit dispatch contention telemetry for a delivery replay", async () => {
    const recordContention = vi.fn();
    const first = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      observability: { recordLockContentionMetric: recordContention },
      trigger: trigger(96, "same-delivery"),
    });
    const replay = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      observability: { recordLockContentionMetric: recordContention },
      trigger: trigger(96, "same-delivery"),
    });

    expect(first.mode).toBe("dispatched");
    expect(replay).toMatchObject({ mode: "lease_contention", reason: "delivery_replay" });
    expect(recordContention).not.toHaveBeenCalled();
  });

  it("does not let an orphaned audit lease consume capacity after its run is deleted", async () => {
    const first = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(96),
    });
    await context.db.delete(loopRuns).where(eq(loopRuns.id, first.runId));

    const second = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:01.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(97),
    });
    expect(second.mode).toBe("dispatched");
    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.status, "acquired")),
    ).toEqual([
      expect.objectContaining({ runId: null }),
      expect.objectContaining({ runId: second.runId }),
    ]);
  });

  it("repairs a leaked acquired lease when a terminal finalization is replayed", async () => {
    const run = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: trigger(96),
    });
    const completedAt = new Date("2026-07-24T16:05:00.000Z");
    await context.db
      .update(loopRuns)
      .set({ completedAt, status: "failed", terminalReason: "failed" })
      .where(eq(loopRuns.id, run.runId));

    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:06:00.000Z"),
      reason: "failed",
      runId: run.runId,
    });
    const [lease] = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.runId, run.runId));
    expect(lease).toMatchObject({ releasedAt: completedAt, status: "released" });
  });
});
