# ADR 0007: Explicit Seed Data And Fixture Policy

Status: Accepted
Date: 2026-06-20

## Context

Loopworks needs local and development stand-ins for GitHub OAuth, GitHub webhooks, Vercel deployments, repo catalogs, loop runs, artifacts, and approval gates. These fixtures make the app inspectable early and support Playwright, Storybook, and demos. The risk is that fixture behavior can silently mask missing production integration.

## Decision

Loopworks will use explicit seed data and fixtures for local development, tests, Storybook, and demos. Fixture mode must be obvious in code, API responses, logs, and docs.

Production code must not silently fall back to fake data when required credentials or durable stores are missing. Production paths should fail closed with an actionable error or degraded-state response.

## Consequences

This keeps the MVP usable before every external integration is fully wired. It also creates a responsibility to maintain fixture quality so local examples exercise real states: empty, loading, healthy, disabled, blocked, failed, pending approval, approved, rejected, preview, production, and disconnected.

Seed data must never contain real tokens, private keys, customer data, or secret-looking placeholder values.

## Validation

1. Fixture routes and scripts are named explicitly, such as `dev:fixture`.
2. API responses include a fixture or fallback reason when returning stand-in data.
3. Logs include fallback reasons without logging secrets or raw payloads.
4. Playwright and Storybook exercise fixture data intentionally.
5. Production environments reject unsafe local auth bypasses and unsupported in-memory stores.
6. `bun run db:seed` / `bun run db:seed:reset` refuse to run when either the
   runtime looks like production (`NODE_ENV`/`VERCEL_ENV`) or `DATABASE_URL`
   does not point at a loopback host, before touching the database. Portal
   pages that are still fixture-only render an explicit degraded notice, and
   log a structured warning identifying the fixture-gate reason, instead of
   fixture data in production. See `tests/unit/scripts/seed-demo-data.test.ts`,
   `tests/unit/lib/runtime.test.ts`, and `tests/unit/portal/fixture-gated-page.test.tsx`.

## Follow-Ups

1. **Done.** Seeded demo dataset for repos, loops, runs, run steps, artifacts,
   approvals, and Vercel deployments: `src/lib/seed/demo-data.ts`
   (`buildDemoSeedData`), covering every value of `repo_health`, `loop_state`,
   `run_status`, `run_step_status`, `artifact_type`, `approval_status`, and
   `deployment_status`, across both `production` and `preview` environments.
   Verified by `tests/unit/seed/demo-data.test.ts`.
2. **Done.** Reset and reseed commands: `bun run db:seed` (idempotent upsert
   by fixed id) and `bun run db:seed:reset`, implemented in
   `scripts/seed-demo-data.ts`. Reset deletes only the fixed-id rows this
   module owns (via `demoSeedIds`), in FK-safe order, never a whole-table
   truncate — any non-demo rows sharing the same tables are left untouched.
   Verified by `tests/unit/seed/demo-data.test.ts`.
3. **Done.** Tests that fixture fallback cannot run in production:
   `scripts/seed-demo-data.ts` checks `isProductionRuntime()` **and** that
   `DATABASE_URL` resolves to a loopback host, before any database dependency
   is touched, and refuses to seed if either check fails
   (`tests/unit/scripts/seed-demo-data.test.ts`). The `DATABASE_URL` check
   exists because a runtime-label check alone is not sufficient: an
   operator's local shell can have `DATABASE_URL` pointed at a real Postgres
   host while `NODE_ENV`/`VERCEL_ENV` are unset. Note that Next.js sets
   `NODE_ENV=production` for every optimized build, including Vercel Preview
   deployments, not only Production — `isProductionRuntime` therefore fails
   closed on Preview too, which is the safe direction
   (`tests/unit/lib/runtime.test.ts`). `runs` was moved to a database-backed
   read path by issue #12. Issue #37 moved the remaining guarded portal pages
   (`dashboard`, `catalog`, `loops`, `approvals`, and `settings`) to seeded
   database reads with explicit `source` / `fallbackReason` semantics via
   `src/lib/portal/records.ts`. Those pages no longer use `FixtureGatedPage`;
   production database failures return unavailable live-data states instead of
   static fixture records (`tests/unit/portal/portal-records.test.ts` and
   `tests/unit/portal/pages.test.tsx`). The `FixtureGatedPage` primitive and
   tests remain as a reusable fail-closed guard for future fixture-only
   surfaces.
4. **Done.** Adding a new fixture state:
   - If the state is a new Drizzle enum value, add it to the enum in
     `src/db/schema.ts` and run `bun run db:generate` for the migration.
   - Extend `buildDemoSeedData()` in `src/lib/seed/demo-data.ts` so the new
     value is seeded at least once, then extend the enum-coverage assertions
     in `tests/unit/seed/demo-data.test.ts`.
   - If the state is UI-facing, extend `portalFixture` in `src/lib/fixtures.ts`
     and the `Status`/`STATUS_META` vocabulary in
     `src/components/ui/status-badge.tsx` if it introduces a new status value.
   - Add or update the relevant Storybook story so the state is reviewable in
     isolation, per `src/components/AGENTS.md`.
