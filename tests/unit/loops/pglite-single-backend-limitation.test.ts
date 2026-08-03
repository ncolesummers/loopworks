/** @vitest-environment node */

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

/**
 * The standing counterexample for why the native PostgreSQL admission lane
 * exists (issue #101).
 *
 * PGlite runs one embedded backend, so there is no second session that could be
 * observed waiting on a lock. Dispatch admission's correctness rests on
 * `SELECT ... FOR UPDATE` making a competing session wait, and that is exactly
 * what cannot be expressed here. Cross-session lock scheduling therefore belongs
 * in `tests/integration/postgres/`.
 *
 * These assertions are structural, so they hold without sleeps or timing races.
 */
describe("PGlite cannot establish multi-session lock scheduling", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  afterEach(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  it("exposes no client backends to observe at all", async () => {
    const backends = await context.client.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE backend_type = 'client backend'",
    );

    // The embedded engine does not populate pg_stat_activity, so the view the
    // native lane relies on to witness a lock wait is empty by construction.
    expect(backends.rows).toHaveLength(0);
  });

  it(
    "reports the same backend PID for every connection handle",
    async () => {
      const second = await createPgliteTestDatabase();
      try {
        const [first, other] = await Promise.all([
          context.client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
          second.client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
        ]);

        // Separate PGlite instances are separate processes-in-WASM, not separate
        // sessions on one server, so they can never contend for the same row.
        expect(first.rows[0].pid).toBe(other.rows[0].pid);
      } finally {
        await second.close();
      }
    },
    pgliteTestHookTimeoutMs,
  );

  it("never records a lock wait, because no session can block another", async () => {
    await context.client.query("BEGIN");
    await context.client.query("CREATE TABLE lock_probe (key text PRIMARY KEY)");
    await context.client.query("INSERT INTO lock_probe VALUES ('guard')");

    const waits = await context.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock'",
    );
    await context.client.query("ROLLBACK");

    expect(waits.rows[0].count).toBe(0);
  });
});
