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
6. Keep e2e tests runnable with `LOOPWORKS_AUTH_BYPASS=true` unless the test is
   specifically covering real auth.
7. For auth allowlist or session-policy changes, add focused unit tests under
   `tests/unit/auth/` that cover allow, deny, and fail-closed paths before
   editing production code.
8. For Drizzle store behavior that depends on real Postgres semantics (conflict
   targets, `where` predicates, transaction rollback), add pglite-backed
   integration tests via `createPgliteTestDatabase` (`tests/helpers/pglite.ts`)
   instead of relying on hand-rolled in-memory fakes.
9. PGlite runs one embedded backend and does not populate `pg_stat_activity`, so
   it cannot demonstrate lock waiting between concurrent sessions; see
   `tests/unit/loops/pglite-single-backend-limitation.test.ts`. For behavior
   that depends on cross-session lock scheduling (`SELECT ... FOR UPDATE`
   contention, admission serialization), add a test under
   `tests/integration/postgres/` using `createNativePostgresTestDatabase`
   (`tests/helpers/native-postgres.ts`) and run it with
   `bun run test:integration:postgres`. Observe the wait through the lock views
   via `waitForRowLockWait`, which verifies the blocking backend's identity;
   never substitute sleeps, retry loops, or repeated stress runs.
10. A lock-wait observation only proves what its preconditions allow. Waiting on
    `SELECT ... FOR UPDATE` and waiting on an `ON CONFLICT` speculative insert
    are indistinguishable in the lock views, so commit any guard row before
    contending on it and assert it is committed; otherwise the test can pass for
    the wrong reason.

## Validation

Include `bun run test` and relevant Playwright, Storybook, or Storybook-native
component checks in final validation evidence.
For auth changes, run the focused auth tests, `bun run typecheck`, and
`bun run format:check` before the final aggregate validation.
