/** @vitest-environment node */

import { and, eq, inArray } from "drizzle-orm";

import { idempotencyLocks, loopRuns, repositories } from "@/db/schema";
import {
  type DevelopmentLoopRunDatabase,
  dispatchDevelopmentLoopRun,
  resolveDevelopmentLoopConcurrencyGroup,
} from "@/lib/loops/development-run";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createResearchLoopRun } from "@/lib/loops/research-run";
import type { LoopManifest } from "../../../schemas/loop-manifest";
import {
  awaitParked,
  createNativePostgresTestDatabase,
  createPreCommitBarrier,
  currentBackendPid,
  gatePreCommit,
  type NativePostgresTestDatabase,
  type PreCommitBarrier,
  resetDatabaseState,
  waitForRowLockWait,
} from "../../helpers/native-postgres";

const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const repositoryFullName = "ncolesummers/loopworks";
const nonterminalStatuses = ["queued", "running", "waiting_for_approval", "blocked"] as const;

function runDatabase(handle: NativePostgresTestDatabase): DevelopmentLoopRunDatabase {
  return handle.db as unknown as DevelopmentLoopRunDatabase;
}

function manifestWith(input: { maxInFlight: number }): LoopManifest {
  return {
    ...defaultLoopManifest,
    loops: defaultLoopManifest.loops.map((loop) =>
      loop.key === "development-loop"
        ? { ...loop, concurrency: { ...loop.concurrency, maxInFlight: input.maxInFlight } }
        : loop,
    ),
  };
}

function trigger(issueNumber: number, deliveryId = `issue-${issueNumber}-delivery`) {
  return {
    body: `## Acceptance Criteria\n- Dispatch issue ${issueNumber} durably.`,
    deliveryId,
    issueNumber,
    issueUrl: `https://github.com/${repositoryFullName}/issues/${issueNumber}`,
    labels: ["agent-ready", "area:loops"],
    milestone: "M3 Durable Loop MVP",
    repositoryFullName,
    title: `Issue ${issueNumber}`,
  };
}

/**
 * Tracks settlement without consuming the promise, so the test can assert that a
 * blocked admission had not completed at a chosen moment.
 */
function trackSettlement<T>(promise: Promise<T>): { settled: () => boolean } {
  let settled = false;
  const mark = () => {
    settled = true;
  };
  promise.then(mark, mark);
  return { settled: () => settled };
}

describe("development-loop dispatch admission on native PostgreSQL", () => {
  let winner: NativePostgresTestDatabase;
  let loser: NativePostgresTestDatabase;
  let observer: NativePostgresTestDatabase;
  let repositoryId: string;
  let openBarriers: PreCommitBarrier[] = [];
  let inFlight: Promise<unknown>[] = [];

  /** Barriers are released in cleanup so a failed assertion cannot wedge afterEach. */
  function barrier(): PreCommitBarrier {
    const created = createPreCommitBarrier();
    openBarriers.push(created);
    return created;
  }

  /**
   * Registers a promise so cleanup can await it before closing connections.
   * Closing a session while its transaction is still committing would reject with
   * a connection error and mask whichever assertion actually failed.
   */
  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.push(promise.catch(() => undefined));
    return promise;
  }

  /**
   * Commits the persistent guard rows before the contended dispatches run, using
   * the keys production derives rather than hardcoded strings.
   *
   * Without pre-committed guards the contending transactions would create them,
   * and the losing session would block on the `ON CONFLICT DO NOTHING`
   * speculative insert instead of on `SELECT ... FOR UPDATE`. That incidental
   * wait does not exist in production, where the guard rows already exist.
   */
  async function seedCommittedGuardRows(input: { group: string; issueNumbers: number[] }) {
    const stamp = new Date("2026-07-24T15:00:00.000Z");
    const guardRow = (key: string, scope: string) => ({
      acquiredAt: stamp,
      expiresAt: stamp,
      key,
      owner: "loopworks:dispatch-admission",
      releasedAt: stamp,
      scope,
      status: "released" as const,
    });

    await observer.db
      .insert(idempotencyLocks)
      .values([
        guardRow(`loop:dispatch:group-guard:${input.group}`, "loop:dispatch:group-guard"),
        ...input.issueNumbers.map((issueNumber) =>
          guardRow(
            `loop:dispatch:issue-guard:${repositoryId}:${issueNumber}`,
            "loop:dispatch:issue-guard",
          ),
        ),
      ]);
  }

  /**
   * Fails if the guard row is not already committed and visible, which is the
   * precondition that makes the observed lock wait a `FOR UPDATE` wait.
   */
  async function assertGuardRowCommitted(key: string) {
    const rows = await observer.db
      .select({ id: idempotencyLocks.id })
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.key, key));
    expect(rows, `guard row ${key} must be committed before contention`).toHaveLength(1);
  }

  beforeEach(async () => {
    openBarriers = [];
    inFlight = [];
    winner = await createNativePostgresTestDatabase();
    loser = await createNativePostgresTestDatabase();
    observer = await createNativePostgresTestDatabase();
    await resetDatabaseState(observer);
    const [repository] = await observer.db
      .insert(repositories)
      .values({
        githubRepoId: 101_000_001,
        owner: "ncolesummers",
        name: "loopworks",
        fullName: repositoryFullName,
      })
      .returning({ id: repositories.id });
    repositoryId = repository.id;
  });

  afterEach(async () => {
    for (const open of openBarriers) open.release();
    await Promise.all(inFlight);
    await Promise.all([winner.close(), loser.close()]);
    await resetDatabaseState(observer);
    await observer.close();
  });

  it("uses independently verifiable backends for the contending sessions", async () => {
    const pids = await Promise.all([
      currentBackendPid(winner),
      currentBackendPid(loser),
      currentBackendPid(observer),
    ]);
    for (const pid of pids) {
      expect(Number.isInteger(pid)).toBe(true);
      expect(pid).toBeGreaterThan(0);
    }
    expect(new Set(pids).size).toBe(3);
  });

  it("serializes over-cap admission on the group guard across two sessions", async () => {
    const manifest = manifestWith({ maxInFlight: 1 });
    const group = resolveDevelopmentLoopConcurrencyGroup({ manifest, repositoryFullName });
    await seedCommittedGuardRows({ group, issueNumbers: [96, 97] });
    await assertGuardRowCommitted(`loop:dispatch:group-guard:${group}`);

    const winnerPid = await currentBackendPid(winner);
    const loserPid = await currentBackendPid(loser);
    const gate = barrier();

    const winnerPromise = track(
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T16:00:00.000Z"),
        database: gatePreCommit(runDatabase(winner), gate),
        manifest,
        traceId,
        trigger: trigger(96),
      }),
    );

    // The winner holds the group guard FOR UPDATE and is parked pre-commit.
    await awaitParked(gate, winnerPromise);

    const loserPromise = track(
      dispatchDevelopmentLoopRun({
        clock: () => new Date("2026-07-24T16:00:01.000Z"),
        database: runDatabase(loser),
        manifest,
        traceId,
        trigger: trigger(97),
      }),
    );
    const loserSettlement = trackSettlement(loserPromise);

    // AC4: PostgreSQL itself reports the loser waiting for a row lock in
    // idempotency_locks held by the winner. Verifying the blocker and the
    // relation rules out an incidental wait on the guard's insert conflict.
    const wait = await waitForRowLockWait(observer, {
      blockedPid: loserPid,
      expectedBlockerPid: winnerPid,
      relation: "idempotency_locks",
    });
    expect(wait.blockingPids).toContain(winnerPid);
    expect(loserSettlement.settled()).toBe(false);

    gate.release();
    const [winnerOutcome, loserOutcome] = await Promise.all([winnerPromise, loserPromise]);

    // AC3: exactly one dispatched run, exactly one deferred run.
    expect(winnerOutcome).toMatchObject({ mode: "dispatched" });
    expect(loserOutcome).toMatchObject({ mode: "deferred", reason: "max_in_flight" });

    // AC6: persisted evidence matches the manifest cap.
    const runs = await observer.db
      .select()
      .from(loopRuns)
      .where(inArray(loopRuns.status, [...nonterminalStatuses]));
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.id).sort()).toEqual(
      [winnerOutcome.runId, loserOutcome.runId].sort(),
    );

    const leases = await observer.db
      .select()
      .from(idempotencyLocks)
      .where(and(eq(idempotencyLocks.scope, group), eq(idempotencyLocks.status, "acquired")));
    expect(leases).toEqual([
      expect.objectContaining({
        owner: winnerOutcome.runId,
        runId: winnerOutcome.runId,
        scope: group,
        traceId,
      }),
    ]);
    expect(leases).toHaveLength(manifest.loops[0].concurrency.maxInFlight);

    // The deferred run is queued and owns no lease of any status.
    const deferredRun = runs.find((run) => run.id === loserOutcome.runId);
    expect(deferredRun?.status).toBe("queued");
    expect(deferredRun?.queuedAt).toBeInstanceOf(Date);
    expect(
      await observer.db
        .select()
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.runId, loserOutcome.runId)),
    ).toHaveLength(0);
  });

  it.each([
    {
      label: "development wins and research loses",
      winnerLabel: "development" as const,
    },
    {
      label: "research wins and development loses",
      winnerLabel: "research" as const,
    },
  ])("keeps one issue exclusive across development and research when $label", async ({
    winnerLabel,
  }) => {
    const manifest = defaultLoopManifest;
    const group = resolveDevelopmentLoopConcurrencyGroup({ manifest, repositoryFullName });
    await seedCommittedGuardRows({ group, issueNumbers: [96] });
    await assertGuardRowCommitted(`loop:dispatch:issue-guard:${repositoryId}:96`);

    const winnerPid = await currentBackendPid(winner);
    const loserPid = await currentBackendPid(loser);
    const gate = barrier();

    type AdmissionAttempt = (
      handle: DevelopmentLoopRunDatabase,
      at: string,
    ) => Promise<{ mode: string; runId?: string }>;

    const startDevelopment: AdmissionAttempt = (handle, at) =>
      dispatchDevelopmentLoopRun({
        clock: () => new Date(at),
        database: handle,
        manifest,
        traceId,
        trigger: trigger(96, "development-delivery"),
      });
    const startResearch: AdmissionAttempt = (handle, at) =>
      createResearchLoopRun({
        database: handle,
        now: () => new Date(at),
        trigger: trigger(96, "research-delivery"),
      });

    const startWinner = winnerLabel === "development" ? startDevelopment : startResearch;
    const startLoser = winnerLabel === "development" ? startResearch : startDevelopment;

    const winnerPromise = track(
      startWinner(gatePreCommit(runDatabase(winner), gate), "2026-07-24T16:00:00.000Z"),
    );
    await awaitParked(gate, winnerPromise);

    const loserPromise = track(startLoser(runDatabase(loser), "2026-07-24T16:00:01.000Z"));
    const loserSettlement = trackSettlement(loserPromise);

    const wait = await waitForRowLockWait(observer, {
      blockedPid: loserPid,
      expectedBlockerPid: winnerPid,
      relation: "idempotency_locks",
    });
    expect(wait.blockingPids).toContain(winnerPid);
    expect(loserSettlement.settled()).toBe(false);

    gate.release();

    // AC5: the loser observes typed contention, never a raw unique violation.
    const [winnerOutcome, loserOutcome] = await Promise.all([winnerPromise, loserPromise]);
    expect(winnerOutcome.mode).toBe(winnerLabel === "development" ? "dispatched" : "created");
    expect(loserOutcome).toMatchObject({
      mode: "lease_contention",
      runId: winnerOutcome.runId,
    });

    // AC6: exactly one nonterminal run owns the issue.
    const runs = await observer.db
      .select()
      .from(loopRuns)
      .where(inArray(loopRuns.status, [...nonterminalStatuses]));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id: winnerOutcome.runId, githubIssueNumber: 96 });
  });
});
