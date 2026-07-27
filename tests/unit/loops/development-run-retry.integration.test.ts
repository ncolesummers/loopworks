/** @vitest-environment node */

import { eq } from "drizzle-orm";

import { idempotencyLocks, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  calculateDevelopmentLoopRetryDelaySeconds,
  dispatchDevelopmentLoopRun,
  runDevelopmentLoopRetrySupervisorTick,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  finalizeDevelopmentLoopRun,
  retryDevelopmentLoopStep,
  scheduleDevelopmentLoopStageRetry,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

function runDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

function transitionDatabase(context: PgliteTestDatabase): DevelopmentLoopTransitionDatabase {
  return context.db as unknown as DevelopmentLoopTransitionDatabase;
}

describe("development-loop automatic retries", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      githubRepoId: 96_000_002,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
    });
  });

  afterEach(async () => {
    await context.close();
  });

  it("calculates fixed and capped exponential backoff with total-attempt semantics", () => {
    expect(
      calculateDevelopmentLoopRetryDelaySeconds({
        backoff: { initialSeconds: 30, maxSeconds: 300, strategy: "fixed" },
        completedAttempt: 4,
      }),
    ).toBe(30);
    expect(
      [1, 2, 3, 4, 5, 6].map((completedAttempt) =>
        calculateDevelopmentLoopRetryDelaySeconds({
          backoff: { initialSeconds: 30, maxSeconds: 300, strategy: "exponential" },
          completedAttempt,
        }),
      ),
    ).toEqual([30, 60, 120, 240, 300, 300]);
  });

  it.each([
    "stalled",
    "timed_out",
  ] as const)("preserves a terminal %s run and creates one trace-linked retry from planning", async (reason) => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      traceId,
      trigger: {
        body: "## Acceptance Criteria\n- Preserve this exact trigger.",
        deliveryId: `delivery-${reason}`,
        issueNumber: 96,
        issueUrl: "https://github.com/ncolesummers/loopworks/issues/96",
        labels: ["agent-ready"],
        milestone: "M3 Durable Loop MVP",
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
        title: "Durable dispatch",
      },
    });
    expect(source.mode).toBe("dispatched");

    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      reason,
      runId: source.runId,
    });

    const runs = await context.db.select().from(loopRuns);
    expect(runs).toHaveLength(2);
    const terminal = runs.find(({ id }) => id === source.runId);
    const retry = runs.find(({ id }) => id !== source.runId);
    expect(terminal).toMatchObject({ completedAt: new Date("2026-07-24T16:05:00.000Z") });
    expect(retry).toMatchObject({
      currentStage: "planning",
      queuedAt: new Date("2026-07-24T16:05:30.000Z"),
      status: "queued",
      traceId,
    });
    expect(
      (
        await context.db
          .select()
          .from(runSteps)
          .where(eq(runSteps.runId, retry?.id ?? ""))
      ).find(({ stage }) => stage === "planning")?.queuedAt,
    ).toEqual(new Date("2026-07-24T16:05:00.000Z"));
    expect(retry?.metadata).toMatchObject({
      dispatchAttempt: 2,
      retryOfRunId: source.runId,
      triggerSnapshot: { body: "## Acceptance Criteria\n- Preserve this exact trigger." },
    });
    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.status, "acquired")),
    ).toEqual([]);

    expect(
      await runDevelopmentLoopRetrySupervisorTick({
        clock: () => new Date("2026-07-24T16:05:29.999Z"),
        database: runDatabase(context),
        manifest: defaultLoopManifest,
      }),
    ).toEqual([]);
    const due = await runDevelopmentLoopRetrySupervisorTick({
      clock: () => new Date("2026-07-24T16:05:30.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
    });
    expect(due).toEqual([expect.objectContaining({ runId: retry?.id })]);
    expect(
      (
        await context.db
          .select()
          .from(runSteps)
          .where(eq(runSteps.runId, retry?.id ?? ""))
      ).every((step) => step.traceId === traceId),
    ).toBe(true);
  });

  it("never links a retry for cancellation", async () => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: {
        issueNumber: 96,
        repositoryFullName: "ncolesummers/loopworks",
      },
    });
    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      reason: "canceled_by_reconciliation",
      runId: source.runId,
    });
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
  });

  it("schedules a retryable failed stage and increments its attempt only when due", async () => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      traceId,
      trigger: { issueNumber: 96, repositoryFullName: "ncolesummers/loopworks" },
    });
    const [planning] = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, source.runId));
    await context.db
      .update(runSteps)
      .set({
        completedAt: new Date("2026-07-24T16:05:00.000Z"),
        metadata: { failure: { code: "provider_unavailable", retryable: true } },
        status: "failed",
      })
      .where(eq(runSteps.id, planning.id));
    await context.db
      .update(loopRuns)
      .set({ currentStage: planning.stage, status: "failed" })
      .where(eq(loopRuns.id, source.runId));

    const scheduled = await scheduleDevelopmentLoopStageRetry({
      database: transitionDatabase(context),
      failure: { code: "provider_unavailable", retryable: true },
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      runId: source.runId,
      stage: planning.stage,
    });
    expect(scheduled).toMatchObject({
      attempt: 1,
      eligibleAt: new Date("2026-07-24T16:05:30.000Z"),
      status: "scheduled",
    });
    expect(
      (await context.db.select().from(runSteps).where(eq(runSteps.id, planning.id)))[0],
    ).toMatchObject({ attempt: 1, status: "failed" });
    expect(
      await context.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.status, "acquired")),
    ).toEqual([]);

    await runDevelopmentLoopRetrySupervisorTick({
      clock: () => new Date("2026-07-24T16:05:30.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
    });
    expect(
      (await context.db.select().from(runSteps).where(eq(runSteps.id, planning.id)))[0],
    ).toMatchObject({
      attempt: 2,
      completedAt: null,
      metadata: {
        attemptHistory: [expect.objectContaining({ attempt: 1, status: "failed" })],
      },
      status: "queued",
      traceId,
    });

    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:06:00.000Z"),
      reason: "timed_out",
      runId: source.runId,
    });
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
  });

  it("finalizes exhausted stage work without erasing its failure evidence", async () => {
    const oneAttemptManifest = {
      ...defaultLoopManifest,
      loops: defaultLoopManifest.loops.map((loop) =>
        loop.key === "development-loop"
          ? { ...loop, retryPolicy: { ...loop.retryPolicy, maxAttempts: 1 } }
          : loop,
      ),
    };
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: oneAttemptManifest,
      trigger: { issueNumber: 96, repositoryFullName: "ncolesummers/loopworks" },
    });
    const [planning] = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, source.runId));
    const failure = { code: "provider_unavailable", retryable: true };
    await context.db
      .update(runSteps)
      .set({ metadata: { failure }, status: "failed" })
      .where(eq(runSteps.id, planning.id));
    await context.db
      .update(loopRuns)
      .set({ status: "failed" })
      .where(eq(loopRuns.id, source.runId));

    expect(
      await scheduleDevelopmentLoopStageRetry({
        database: transitionDatabase(context),
        failure,
        manifest: oneAttemptManifest,
        occurredAt: new Date("2026-07-24T16:05:00.000Z"),
        runId: source.runId,
        stage: planning.stage,
      }),
    ).toMatchObject({ attempt: 1, status: "exhausted" });
    expect((await context.db.select().from(loopRuns))[0]).toMatchObject({
      completedAt: new Date("2026-07-24T16:05:00.000Z"),
      status: "failed",
      terminalReason: "failed",
    });
    expect(
      (await context.db.select().from(runSteps).where(eq(runSteps.id, planning.id)))[0],
    ).toMatchObject({ metadata: { failure }, status: "failed" });
  });

  it("does not finalize an ineligible retry request", async () => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: { issueNumber: 96, repositoryFullName: "ncolesummers/loopworks" },
    });
    const [planning] = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, source.runId));

    await expect(
      scheduleDevelopmentLoopStageRetry({
        database: transitionDatabase(context),
        failure: { code: "provider_unavailable", retryable: true },
        manifest: defaultLoopManifest,
        occurredAt: new Date("2026-07-24T16:05:00.000Z"),
        runId: source.runId,
        stage: planning.stage,
      }),
    ).resolves.toMatchObject({ status: "ineligible" });
    expect((await context.db.select().from(loopRuns))[0]).toMatchObject({
      completedAt: null,
      status: "queued",
      terminalReason: null,
    });
  });

  it("shares one total attempt budget across stage and linked retries", async () => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: { issueNumber: 96, repositoryFullName: "ncolesummers/loopworks" },
    });
    await finalizeDevelopmentLoopRun({
      database: transitionDatabase(context),
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      reason: "timed_out",
      runId: source.runId,
    });
    const retry = (await context.db.select().from(loopRuns)).find(({ id }) => id !== source.runId);
    if (!retry) throw new Error("Expected linked retry.");
    const [planning] = await context.db.select().from(runSteps).where(eq(runSteps.runId, retry.id));
    const failure = { code: "provider_unavailable", retryable: true };
    await context.db
      .update(runSteps)
      .set({ metadata: { failure }, status: "failed" })
      .where(eq(runSteps.id, planning.id));
    await context.db.update(loopRuns).set({ status: "failed" }).where(eq(loopRuns.id, retry.id));

    await expect(
      scheduleDevelopmentLoopStageRetry({
        database: transitionDatabase(context),
        failure,
        manifest: defaultLoopManifest,
        occurredAt: new Date("2026-07-24T16:06:00.000Z"),
        runId: retry.id,
        stage: planning.stage,
      }),
    ).resolves.toMatchObject({ attempt: 2, status: "exhausted" });
    expect(await context.db.select().from(loopRuns)).toHaveLength(2);
  });

  it("prevents operator retry from racing a scheduled automatic retry or reviving a terminal run", async () => {
    const source = await dispatchDevelopmentLoopRun({
      clock: () => new Date("2026-07-24T16:00:00.000Z"),
      database: runDatabase(context),
      manifest: defaultLoopManifest,
      trigger: { issueNumber: 96, repositoryFullName: "ncolesummers/loopworks" },
    });
    const [planning] = await context.db
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, source.runId));
    const failure = { code: "provider_unavailable", retryable: true };
    await context.db
      .update(runSteps)
      .set({ metadata: { failure }, status: "failed" })
      .where(eq(runSteps.id, planning.id));
    await context.db
      .update(loopRuns)
      .set({ status: "failed" })
      .where(eq(loopRuns.id, source.runId));
    await scheduleDevelopmentLoopStageRetry({
      database: transitionDatabase(context),
      failure,
      manifest: defaultLoopManifest,
      occurredAt: new Date("2026-07-24T16:05:00.000Z"),
      runId: source.runId,
      stage: planning.stage,
    });

    await expect(
      retryDevelopmentLoopStep({
        database: transitionDatabase(context),
        occurredAt: new Date("2026-07-24T16:05:01.000Z"),
        reason: "operator_retry",
        runId: source.runId,
        stage: planning.stage,
      }),
    ).resolves.toMatchObject({ attempt: 1, idempotent: true });

    await context.db
      .update(loopRuns)
      .set({ completedAt: new Date("2026-07-24T16:05:02.000Z"), status: "failed" })
      .where(eq(loopRuns.id, source.runId));
    await expect(
      retryDevelopmentLoopStep({
        database: transitionDatabase(context),
        reason: "operator_retry",
        runId: source.runId,
        stage: planning.stage,
      }),
    ).rejects.toThrow("terminal run");
  });
});
