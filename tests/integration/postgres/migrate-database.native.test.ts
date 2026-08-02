/** @vitest-environment node */

import postgres from "postgres";

import {
  MIGRATION_ADVISORY_LOCK_ID,
  type MigrationRunnerDependencies,
  runMigrations,
} from "../../../scripts/migrate-database";
import {
  awaitParked,
  createNativePostgresTestDatabase,
  createPreCommitBarrier,
  type NativePostgresTestDatabase,
  waitForAdvisoryLockWait,
} from "../../helpers/native-postgres";

function trackSettlement(promise: Promise<unknown>): { settled: () => boolean } {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { settled: () => settled };
}

describe("database migration runner on native PostgreSQL", () => {
  let observer: NativePostgresTestDatabase;
  let releaseBlockedMigration: (() => void) | undefined;
  let inFlight: Promise<unknown>[] = [];
  let unownedClients = new Set<ReturnType<typeof postgres>>();

  beforeEach(async () => {
    observer = await createNativePostgresTestDatabase();
    releaseBlockedMigration = undefined;
    inFlight = [];
    unownedClients = new Set();
  });

  afterEach(async () => {
    releaseBlockedMigration?.();
    await Promise.all(inFlight);
    await Promise.all([...unownedClients].map((client) => client.end({ timeout: 5 })));
    if (observer) await observer.close();
  });

  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.push(promise.catch(() => undefined));
    return promise;
  }

  it("serializes concurrent migration runners across independent sessions", async () => {
    const firstClient = postgres(observer.url, { max: 1, prepare: false });
    const secondClient = postgres(observer.url, { max: 1, prepare: false });
    unownedClients.add(firstClient);
    unownedClients.add(secondClient);
    const [{ pid: firstPid }] = await firstClient<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid
    `;
    const [{ pid: secondPid }] = await secondClient<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid
    `;
    expect(firstPid).not.toBe(secondPid);

    const gate = createPreCommitBarrier();
    releaseBlockedMigration = gate.release;
    const events: string[] = [];
    const environment = {
      DATABASE_URL: observer.url,
      DATABASE_URL_UNPOOLED: observer.url,
    };
    const firstDependencies: MigrationRunnerDependencies = {
      createClient: () => {
        unownedClients.delete(firstClient);
        return firstClient;
      },
      migrateDatabase: async () => {
        events.push("first-start");
        await gate.hold();
        events.push("first-end");
      },
    };
    const secondDependencies: MigrationRunnerDependencies = {
      createClient: () => {
        unownedClients.delete(secondClient);
        return secondClient;
      },
      migrateDatabase: async () => {
        events.push("second-start");
      },
    };

    const firstRun = track(runMigrations(environment, firstDependencies));
    await awaitParked(gate, firstRun);

    const secondRun = track(runMigrations(environment, secondDependencies));
    const secondSettlement = trackSettlement(secondRun);
    const wait = await waitForAdvisoryLockWait(observer, {
      blockedPid: Number(secondPid),
      expectedBlockerPid: Number(firstPid),
      lockId: MIGRATION_ADVISORY_LOCK_ID,
    });

    expect(wait.blockingPids).toContain(Number(firstPid));
    expect(wait.waitEvent).toBe("advisory");
    expect(secondSettlement.settled()).toBe(false);
    expect(events).toEqual(["first-start"]);

    gate.release();
    await Promise.all([firstRun, secondRun]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });
});
