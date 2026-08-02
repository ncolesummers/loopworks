import path from "node:path";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { getLocalDatabaseSafetyError } from "../../scripts/local-database-safety";

const REQUIRED_DATABASE_NAME = "loopworks_e2e";
const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, "../../drizzle");

/** Serializes schema setup across independent test sessions and workers. */
const SCHEMA_ADVISORY_LOCK_KEY = 101_2026;

export type NativePostgresTestDatabase = {
  client: postgres.Sql;
  db: PostgresJsDatabase<typeof schema>;
  /** The URL this handle actually connected to, re-validated before any cleanup. */
  url: string;
  /** The server-side backend PID, proving this handle is its own session. */
  backendPid: number;
  close: () => Promise<void>;
};

/**
 * Returns the database URL only when it is provably safe to mutate, per ADR 0007.
 * The lane fails closed: it never skips, and never falls back to PGlite, because
 * a silently-skipped concurrency lane would assert nothing about production locking.
 */
function requireSafeDatabaseUrl(env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const safetyError = getLocalDatabaseSafetyError(env, {
    requiredDatabaseName: REQUIRED_DATABASE_NAME,
    requireExplicitUrl: true,
  });
  if (safetyError) {
    throw new Error(
      `${safetyError} The native PostgreSQL admission lane requires a live local ` +
        `${REQUIRED_DATABASE_NAME} database; run it with 'bun run test:integration:postgres'.`,
    );
  }
  // The guard above rejects a missing URL when requireExplicitUrl is set.
  return env.DATABASE_URL as string;
}

async function ensureSchema(client: postgres.Sql): Promise<void> {
  await client`SELECT pg_advisory_lock(${SCHEMA_ADVISORY_LOCK_KEY})`;
  try {
    await migrate(drizzle(client), {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
  } finally {
    await client`SELECT pg_advisory_unlock(${SCHEMA_ADVISORY_LOCK_KEY})`;
  }
}

/**
 * Opens one independent PostgreSQL session against the shared migrated test
 * database. `max: 1` pins the handle to a single backend so that two handles are
 * genuinely two sessions rather than two wrappers over one connection.
 */
export async function createNativePostgresTestDatabase(): Promise<NativePostgresTestDatabase> {
  const url = requireSafeDatabaseUrl();
  const client = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  try {
    await ensureSchema(client);
    const [{ pid }] = await client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;

    return {
      client,
      db: drizzle(client, { schema }),
      url,
      backendPid: Number(pid),
      close: async () => {
        await client.end();
      },
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}

/**
 * Truncates every table in the `public` schema of the test database — not just
 * the dispatch tables — so each test starts from a known-empty state.
 *
 * The safety guard is re-applied to the URL this handle actually connected to,
 * rather than to the ambient environment, so cleanup can never reach a database
 * other than the local one this handle opened.
 */
export async function resetDatabaseState(handle: NativePostgresTestDatabase): Promise<void> {
  requireSafeDatabaseUrl({ ...process.env, DATABASE_URL: handle.url });
  const tables = await handle.client<{ name: string }[]>`
    SELECT quote_ident(tablename) AS name
    FROM pg_tables
    WHERE schemaname = 'public'
  `;
  if (tables.length === 0) return;
  await handle.client.unsafe(
    `TRUNCATE TABLE ${tables.map(({ name }) => name).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export type PreCommitBarrier = {
  /** Resolves once a gated transaction body has finished and is parked pre-commit. */
  readonly parked: Promise<void>;
  release: () => void;
  /** Called by {@link gatePreCommit} from inside the transaction; parks until released. */
  hold: () => Promise<void>;
};

/**
 * A one-shot barrier used to hold a transaction open after it has taken its
 * locks and done its work, but before it commits.
 */
export function createPreCommitBarrier(): PreCommitBarrier {
  let markParked!: () => void;
  let markReleased!: () => void;
  const parked = new Promise<void>((resolve) => {
    markParked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    markReleased = resolve;
  });

  return {
    parked,
    release: () => markReleased(),
    hold: () => {
      markParked();
      return released;
    },
  };
}

/**
 * Wraps a database handle so its *first* transaction parks after the callback
 * resolves and before the commit lands, keeping every row lock it acquired held.
 * Later transactions on the same handle pass straight through, because the
 * barrier is one-shot.
 *
 * A Proxy is used rather than an object spread: a drizzle database keeps
 * `select`/`insert`/`update` on its prototype, so spreading would silently drop
 * every method except the own enumerable ones and break any caller that reads
 * outside the transaction.
 *
 * This is a test-only seam: no production code participates in it.
 */
export function gatePreCommit<TDatabase extends object>(
  database: TDatabase,
  barrier: PreCommitBarrier,
): TDatabase {
  let gated = false;

  return new Proxy(database, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "transaction" || typeof value !== "function") return value;

      return (callback: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) => {
        if (gated) return value.call(target, callback, ...rest);
        gated = true;

        return value.call(
          target,
          async (tx: unknown) => {
            const result = await callback(tx);
            await barrier.hold();
            return result;
          },
          ...rest,
        );
      };
    },
  });
}

/** Returns the backend PID the handle is connected through right now. */
export async function currentBackendPid(handle: NativePostgresTestDatabase): Promise<number> {
  const [{ pid }] = await handle.client<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return Number(pid);
}

export type RowLockWait = {
  blockedPid: number;
  blockingPids: number[];
  waitEvent: string | null;
  /** The statement the blocked backend is parked on, for diagnostics. */
  blockedQuery: string | null;
};

export type AdvisoryLockWait = {
  blockedPid: number;
  blockingPids: number[];
  waitEvent: string | null;
  /** The statement the blocked backend is parked on, for diagnostics. */
  blockedQuery: string | null;
};

/**
 * Resolves once PostgreSQL reports one backend waiting on the exact session-level
 * bigint advisory lock held by another backend.
 *
 * The waiter and holder rows must match on every advisory lock identity field,
 * and the encoded class/object fields must match `lockId`. This prevents an
 * unrelated advisory lock from satisfying the assertion. Polling only observes
 * PostgreSQL's lock views; elapsed time is never used as proof of serialization.
 */
export async function waitForAdvisoryLockWait(
  observer: NativePostgresTestDatabase,
  input: { blockedPid: number; expectedBlockerPid: number; lockId: number },
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<AdvisoryLockWait> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  const lockId = BigInt(input.lockId);
  const classId = Number(BigInt.asUintN(32, lockId >> 32n));
  const objectId = Number(BigInt.asUintN(32, lockId));

  while (Date.now() < deadline) {
    const [waiting] = await observer.client<
      { wait_event: string | null; blocking_pids: number[]; query: string | null }[]
    >`
      SELECT activity.wait_event, activity.query, pg_blocking_pids(activity.pid) AS blocking_pids
      FROM pg_stat_activity AS activity
      WHERE activity.pid = ${input.blockedPid}
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND activity.wait_event = 'advisory'
        AND pg_blocking_pids(activity.pid) @> ARRAY[${input.expectedBlockerPid}]::int[]
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS waited
          JOIN pg_locks AS held
            ON held.locktype = waited.locktype
           AND held.database IS NOT DISTINCT FROM waited.database
           AND held.classid IS NOT DISTINCT FROM waited.classid
           AND held.objid IS NOT DISTINCT FROM waited.objid
           AND held.objsubid IS NOT DISTINCT FROM waited.objsubid
          WHERE waited.pid = activity.pid
            AND waited.locktype = 'advisory'
            AND NOT waited.granted
            AND waited.classid = ${classId}::oid
            AND waited.objid = ${objectId}::oid
            AND waited.objsubid = 1
            AND held.pid = ${input.expectedBlockerPid}
            AND held.granted
        )
    `;
    if (waiting) {
      return {
        blockedPid: input.blockedPid,
        blockingPids: waiting.blocking_pids,
        waitEvent: waiting.wait_event,
        blockedQuery: waiting.query,
      };
    }

    const [alive] = await observer.client<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity WHERE pid = ${input.blockedPid}
    `;
    if (!alive) {
      throw new Error(
        `Backend ${input.blockedPid} is no longer connected, so its advisory lock wait cannot be observed. ` +
          "The session likely reconnected or was closed before the wait was measured.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const [lastSeen] = await observer.client<{ wait_event: string | null; query: string | null }[]>`
    SELECT wait_event, query FROM pg_stat_activity WHERE pid = ${input.blockedPid}
  `;
  throw new Error(
    `Backend ${input.blockedPid} never waited on advisory lock ${input.lockId} held by backend ` +
      `${input.expectedBlockerPid} within ${timeoutMs}ms. Last observed ` +
      `wait_event=${lastSeen?.wait_event ?? "none"} query=${lastSeen?.query ?? "none"}`,
  );
}

/**
 * Resolves once PostgreSQL reports `blockedPid` waiting on a lock held by
 * `expectedBlockerPid`, while `blockedPid` also holds a row lock on `relation`.
 *
 * Two things are verified, and both matter:
 *
 * 1. The blocker's identity, via `pg_blocking_pids`. A bare "is waiting on some
 *    lock" check would accept a wait caused by anything at all.
 * 2. A *granted `tuple` lock* on `relation` held by the waiter. That is the
 *    signature of row contention on that specific table: a backend blocking on
 *    `SELECT ... FOR UPDATE` takes the tuple lock first, then waits on the
 *    holder's transaction id. Merely checking that the waiter holds some lock on
 *    `relation` is not enough — a transaction that touched the table earlier
 *    keeps relation-level locks for the rest of its life, so a wait on an
 *    entirely different table's unique index would pass that weaker check.
 *
 * What this still cannot tell apart is a `SELECT ... FOR UPDATE` wait from a
 * wait on a speculative `ON CONFLICT` insert against the same row — both block
 * on the holder's transaction id. Callers must therefore assert that the guard
 * row is already committed before contending, which makes the insert-conflict
 * path impossible.
 *
 * This observes real transaction overlap through the lock views; it is not a
 * wall-clock stand-in for the assertion. It fails closed if the wait never
 * appears, and fails fast if the blocked backend disappears entirely.
 */
export async function waitForRowLockWait(
  observer: NativePostgresTestDatabase,
  input: { blockedPid: number; expectedBlockerPid: number; relation: string },
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<RowLockWait> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [waiting] = await observer.client<
      { wait_event: string | null; blocking_pids: number[]; query: string | null }[]
    >`
      SELECT activity.wait_event, activity.query, pg_blocking_pids(activity.pid) AS blocking_pids
      FROM pg_stat_activity AS activity
      WHERE activity.pid = ${input.blockedPid}
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND pg_blocking_pids(activity.pid) @> ARRAY[${input.expectedBlockerPid}]::int[]
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS waited
          WHERE waited.pid = activity.pid
            AND NOT waited.granted
        )
        AND EXISTS (
          SELECT 1
          FROM pg_locks AS rowLock
          WHERE rowLock.pid = activity.pid
            AND rowLock.granted
            AND rowLock.locktype = 'tuple'
            AND rowLock.relation = ${input.relation}::regclass
        )
    `;
    if (waiting) {
      return {
        blockedPid: input.blockedPid,
        blockingPids: waiting.blocking_pids,
        waitEvent: waiting.wait_event,
        blockedQuery: waiting.query,
      };
    }

    const [alive] = await observer.client<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity WHERE pid = ${input.blockedPid}
    `;
    if (!alive) {
      throw new Error(
        `Backend ${input.blockedPid} is no longer connected, so its lock wait cannot be observed. ` +
          "The session likely reconnected or was closed before the wait was measured.",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const [lastSeen] = await observer.client<{ wait_event: string | null; query: string | null }[]>`
    SELECT wait_event, query FROM pg_stat_activity WHERE pid = ${input.blockedPid}
  `;
  throw new Error(
    `Backend ${input.blockedPid} never held a granted tuple lock on ${input.relation} while ` +
      `waiting on backend ${input.expectedBlockerPid} within ${timeoutMs}ms. Expected the ` +
      "competing admission transaction to block on the guard row selected FOR UPDATE. " +
      `Last observed wait_event=${lastSeen?.wait_event ?? "none"} query=${lastSeen?.query ?? "none"}`,
  );
}

/**
 * Awaits a barrier reaching its pre-commit park, but fails fast if the gated
 * work rejects first. Without this, any error thrown before the barrier is
 * reached would hang until the Vitest timeout and surface as an unhandled
 * rejection instead of the real cause.
 */
export async function awaitParked(
  barrier: PreCommitBarrier,
  gatedWork: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    barrier.parked,
    gatedWork.then(
      () => {
        throw new Error(
          "The gated transaction completed without parking at the pre-commit barrier.",
        );
      },
      (error: unknown) => {
        throw new Error(
          `The gated transaction failed before reaching the pre-commit barrier: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    ),
  ]);
}
