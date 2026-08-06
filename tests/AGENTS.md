# Test Guide

## Scope

This guide applies to Vitest, Playwright, Storybook validation, fixtures, and
test helpers under `tests/`.

## Rules

1. Keep tests close to the behavior and risk being changed.
2. Use Vitest for shared logic, auth, GitHub/Vercel integration, approvals,
   manifests, observability, and agent contracts.
3. Use Playwright for user-visible workflows and persona-derived acceptance
   scenarios.
4. Use Storybook-native component and a11y tooling for story-level reusable UI
   checks when configured; do not add bespoke Storybook iframe crawlers for
   inventory-only assertions.
5. Use explicit fixtures. Do not add silent production fallbacks.
6. No test may reach the network. `tests/setup.ts` registers one shared MSW
   server (`tests/helpers/msw.ts`); unstubbed requests are blocked, recorded,
   and re-thrown in `afterEach`, so an escaped request fails the test even if
   the code under test swallows the error. Stub per test with
   `mswServer.use(...)`; handlers reset after each test. Never add default
   handlers to the shared server — a default handler is a silent fallback, and
   rule 5 forbids it.
7. Cover the *default* factory behind an injectable seam, not only the injected
   fake. Fakes encode what we believe a third-party client does; MSW exercises
   what it actually does. #152 shipped a production outage because every test
   injected a fake `paginate` and the real default client had none. See
   ADR 0022.
8. Keep e2e tests runnable with `LOOPWORKS_AUTH_BYPASS=true` unless the test is
   specifically covering real auth.
9. For auth allowlist or session-policy changes, add focused unit tests under
   `tests/unit/auth/` that cover allow, deny, and fail-closed paths before
   editing production code.
10. For Drizzle store behavior that depends on real Postgres semantics (conflict
    targets, `where` predicates, transaction rollback), add pglite-backed
    integration tests via `createPgliteTestDatabase` (`tests/helpers/pglite.ts`)
    instead of relying on hand-rolled in-memory fakes.
11. Reuse one migrated PGlite database per integration-test file when tests only
    mutate application rows: create it in `beforeAll`, call `reset()` first in
    `beforeEach`, and close it in `afterAll`. Use `pgliteTestHookTimeoutMs` for
    those lifecycle hooks so healthy migration replay never depends on Vitest's
    default five-second budget. Reset truncates every migrated `public` table
    with identity restart and cascading foreign-key cleanup while preserving
    Drizzle migration metadata; cleanup failures must fail the suite. Keep a
    fresh database when the test covers migration replay, database lifecycle,
    schema/session state, or intentionally independent PGlite instances. Never
    leave a transaction open across tests.
12. PGlite runs one embedded backend and does not populate `pg_stat_activity`, so
    it cannot demonstrate lock waiting between concurrent sessions; see
    `tests/unit/loops/pglite-single-backend-limitation.test.ts`. For behavior
    that depends on cross-session lock scheduling (`SELECT ... FOR UPDATE`
    contention, admission serialization), add a test under
    `tests/integration/postgres/` using `createNativePostgresTestDatabase`
    (`tests/helpers/native-postgres.ts`) and run it with
    `bun run test:integration:postgres`. Observe the wait through the lock views
    via `waitForRowLockWait`, which verifies the blocking backend's identity;
    never substitute sleeps, retry loops, or repeated stress runs.
13. A lock-wait observation only proves what its preconditions allow. Waiting on
    `SELECT ... FOR UPDATE` and waiting on an `ON CONFLICT` speculative insert
    are indistinguishable in the lock views, so commit any guard row before
    contending on it and assert it is committed; otherwise the test can pass for
    the wrong reason.
14. Identify a row-lock wait by a granted `tuple` lock on the target relation,
    never by "the waiter holds some lock on that relation". A transaction keeps
    relation-level locks on every table it has touched, so the weaker check also
    matches a wait on an unrelated table — for example blocking on the
    `loop_runs` uniqueness index long after touching `idempotency_locks`.

## Validation

Include `bun run test` and relevant Playwright, Storybook, or Storybook-native
component checks in final validation evidence.
For auth changes, run the focused auth tests, `bun run typecheck`, and
`bun run check` before the final aggregate validation.
