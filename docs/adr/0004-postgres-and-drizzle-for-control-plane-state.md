# ADR 0004: Postgres And Drizzle For Control-Plane State

Status: Accepted
Date: 2026-06-20

## Context

Loopworks needs an internal control plane for data GitHub and Vercel should not own: normalized events, idempotency locks, runs, steps, artifacts, approvals, costs, retries, traces, metrics projections, catalog projections, loop manifests, and auth/session data.

The project needs typed schema ownership early without heavy enterprise infrastructure.

## Decision

Loopworks will use Postgres for persistence and Drizzle for schema, migrations, and typed data access. Drizzle schema files are the source of truth for database shape in the repo. Auth.js persistence, repo catalog state, Vercel projections, loop state, webhook deliveries, idempotency locks, approvals, artifacts, and observability projections should use this database.

Updated 2026-08-02 for [issue #113](https://github.com/ncolesummers/loopworks/issues/113):
the canonical programmatic PostgreSQL migrator reads Drizzle's generated
journal and preserves its `drizzle.__drizzle_migrations` bookkeeping, but
commits one migration file at a time. A bookkeeping row commits atomically with
the file it represents. This transaction boundary is required because
PostgreSQL will not allow a later migration to use a new enum label until the
migration that added it has committed. `bun run db:migrate` and native
PostgreSQL tests use this shared path. The shared migrator reserves one database
session and holds a PostgreSQL advisory lock across discovery and every file so
concurrent deploy hooks cannot apply or record the same migration twice.

## Consequences

Postgres is durable, familiar, and suitable for transactional workflow state. Drizzle keeps schema definitions close to TypeScript code and avoids a separate ORM runtime model that hides SQL shape.

If a later migration file fails, earlier files remain committed and the failing
file leaves neither partial statements nor a bookkeeping row. A retry resumes
from the latest committed journal timestamp. Migration authors must keep an
enum addition and its first use in separate files; the canonical migrator
provides the commit boundary between them. The command continues to read
Drizzle configuration, including custom output folders and migration
bookkeeping schema/table names.

The repo must avoid pretending in-memory stores are production-ready. In-memory stores may be used only as explicit local/dev fixtures and must fail closed or clearly report unsupported production behavior.

## Validation

1. Durable workflow state has Drizzle schema coverage before production use.
2. Auth.js uses the Drizzle adapter for database-backed sessions, and
   `users.github_login` persists the GitHub identity used for audit and approval
   attribution.
3. Webhook idempotency and approval transitions are backed by transactional
   records before MVP completion.
4. Tests cover schema-dependent behavior through focused unit or integration
   tests.
5. Migration commands are documented and run in CI or release checks when
   migrations exist.
6. Native PostgreSQL tests replay the full generated journal from empty and
   exercise an existing-enum add/use pair that fails when pending files share
   one transaction.
7. Command tests keep `bun run db:migrate` on the shared programmatic path and
   verify Drizzle config compatibility, credential-safe actionable failure
   reporting, and connection cleanup.
8. Native PostgreSQL tests run two migration callers concurrently and prove one
   application and one bookkeeping row.

## Follow-Ups

1. Add a database health check and local bootstrap path around the generated
   initial migration.
2. Define transaction boundaries for webhook intake, run creation, approval
   transitions, and PR creation.
3. Decide whether event sourcing remains append-only events plus projections or
   simpler current-state rows plus audit events.
