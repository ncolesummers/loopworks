# ADR 0004: Postgres And Drizzle For Control-Plane State

Status: Accepted
Date: 2026-06-20

## Context

Loopworks needs an internal control plane for data GitHub and Vercel should not own: normalized events, idempotency locks, runs, steps, artifacts, approvals, costs, retries, traces, metrics projections, catalog projections, loop manifests, and auth/session data.

The project needs typed schema ownership early without heavy enterprise infrastructure.

## Decision

Loopworks will use Postgres for persistence and Drizzle for schema, migrations, and typed data access. Drizzle schema files are the source of truth for database shape in the repo. Auth.js persistence, repo catalog state, Vercel projections, loop state, webhook deliveries, idempotency locks, approvals, artifacts, and observability projections should use this database.

## Consequences

Postgres is durable, familiar, and suitable for transactional workflow state. Drizzle keeps schema definitions close to TypeScript code and avoids a separate ORM runtime model that hides SQL shape.

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

## Follow-Ups

1. Add a database health check and local bootstrap path around the generated
   initial migration.
2. Define transaction boundaries for webhook intake, run creation, approval
   transitions, and PR creation.
3. Decide whether event sourcing remains append-only events plus projections or
   simpler current-state rows plus audit events.
