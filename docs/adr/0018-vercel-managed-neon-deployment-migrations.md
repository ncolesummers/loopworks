# ADR 0018: Vercel-Managed Neon Deployment Migrations

Status: Superseded by [0035](0035-cost-bounded-neon-preview-database-topology.md)
Date: 2026-08-02
Issue: [#70](https://github.com/ncolesummers/loopworks/issues/70)

## Context

Loopworks uses Vercel for Production and Preview deployments and Postgres with
Drizzle for durable control-plane state. A Vercel-managed Neon resource already
provides hosted database connections, but deployments can reach the database
before its repository-owned migrations have run. The result is a connected
deployment whose reads fail because required relations do not exist.

Runtime traffic and migration administration also have different connection
requirements. Application queries should use Neon's pooled connection, while
Drizzle migrations need a direct connection. Preview deployments additionally
need an isolated database lifecycle without application-owned provider
credentials or branch orchestration.

## Decision

1. Use the Vercel-managed Neon resource as the hosted Postgres provider. Connect
   it to Vercel Production and Preview, but not Development; local development
   continues to use local Postgres.
2. Keep runtime queries on the pooled `DATABASE_URL`. The existing Postgres.js
   client keeps `prepare: false` for compatibility with the pooled connection.
3. Run Drizzle migrations with `DATABASE_URL_UNPOOLED`. Migration configuration
   prefers a non-empty direct URL and fails closed with a credential-safe error
   when Vercel Production/Preview or Neon metadata identifies a hosted target
   but either required URL is missing. It validates Postgres URL syntax, the
   expected pooled/direct Neon endpoints, and that both URLs identify the same
   Neon branch and database before connecting. Only non-hosted operation may
   fall back to `DATABASE_URL` and then the existing loopback default.
4. Define `bun run vercel-build` as `bun run db:migrate && bun run build` so
   every hosted deployment applies repository-owned migrations before Next.js
   reads the database. The repository migration runner holds a database-scoped
   Postgres advisory lock around Drizzle migration execution so overlapping
   builds serialize. Keep ordinary `bun run build` migration-free.
5. Require the provider-managed Preview deployment actions. Neon and Vercel
   create the isolated Preview branch, inject its branch-specific connections
   before the build, and clean up the branch with the Preview lifecycle.
   Loopworks does not create, identify, or delete those branches itself.
6. Never run the demo seed or reset commands against Production or Preview.
   Hosted branches inherit provider-managed data state and schema; ADR 0007's
   local-only seed guard remains authoritative.

## Consequences

- Production and Preview builds stop before the application build if the direct
  migration connection is unavailable or disagrees with the runtime target.
- Runtime traffic retains pooling while migration and administrative work avoid
  the pooler.
- Each Preview can apply its commit's migrations without changing Production or
  another active Preview.
- Deployment success now depends on both the Neon integration actions and the
  repository migration history.
- Overlapping builds that target one database wait on the same advisory lock
  instead of racing the Drizzle migration journal and DDL.
- Local builds stay fast and do not mutate a database implicitly; developers
  choose when to run `bun run db:migrate`.
- Preview branch identity and cleanup evidence live in the provider lifecycle
  rather than in the application or repository.

## Validation

1. `tests/unit/db/neon-migration-config.test.ts` proves direct-URL precedence,
   hosted fail-closed behavior, target consistency, credential-safe errors,
   local fallback, and the migration-before-build script order.
2. `tests/unit/scripts/migrate-database.test.ts` proves the advisory lock wraps
   migrations and is released, with the connection closed, on success and
   failure. `tests/integration/postgres/migrate-database.native.test.ts` proves
   two independent PostgreSQL sessions serialize on that exact advisory lock.
3. Existing seed CLI tests prove Production, malformed, missing, and
   non-loopback targets are rejected before a database call.
4. `bun run markdownlint`, `bun run typecheck`, `bun run build`, and
   `bun run validate` verify the repository contract.
5. After publication, inspect a Preview deployment to confirm the required Neon
   actions precede the build, migrations precede Next.js, the deployment is
   ready, and database reads do not report missing relations or fixture
   fallback.
6. After an authorized Production deployment, verify the same migration order
   and clean read path in Production logs.

## Follow-Ups

1. Link this Proposed ADR from Issue 70 when the implementation is published.
2. Record Preview and Production deployment identifiers and log evidence in the
   pull request before accepting this ADR.
3. Keep provider action configuration as the isolation proof unless Vercel or
   Neon exposes deployment-specific branch identity through the available
   project API.
4. Before shipping multiple pending migrations that introduce and then consume
   a Postgres enum value, split their deployment across releases or adopt a
   per-migration transaction policy. Drizzle applies all migrations pending at
   one invocation in a single transaction, and Postgres cannot consume a newly
   added enum value until that transaction commits.
