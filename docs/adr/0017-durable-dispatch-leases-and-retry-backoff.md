# ADR 0017: Durable Dispatch Leases and Retry Backoff

Status: Proposed
Date: 2026-07-24
Issue: [#96](https://github.com/ncolesummers/loopworks/issues/96)

## Context

Webhook idempotency prevents replaying one delivery, but it does not enforce a
manifest concurrency cap across different deliveries or hosts. In-memory
semaphores also lose authority on restart. Retry behavior needs the same durable
boundary: delayed work cannot depend on sleeps, terminal evidence must remain
inspectable, and attempt limits must mean the same thing in every runtime path.

## Decision

Use Postgres admission transactions and `idempotency_locks` as the durable
dispatch authority. A persistent group-guard row is selected `FOR UPDATE`
before capacity is counted. Acquired leases in the resolved manifest group
consume capacity even after their expiry until their owner is finalized; this
prevents an expired-but-running attempt from overlapping its successor.

Every issue-backed run is protected by a partial unique index over repository
and issue while its status is nonterminal. This applies across loop types.
Delivery IDs remain replay keys, not concurrency identities. `{repo}` resolves
to the canonical repository full name; other unresolved placeholders are
rejected. A persistent repository/issue guard serializes development and
research creation before the cross-loop uniqueness check, so contention is a
typed outcome rather than a raw constraint error.

Over-cap work is persisted as a queued run without a lease. Queue draining is
ordered by `queuedAt`, then issue number, and acquires leases up to the manifest
cap. Lease-less runs cannot enter a development stage. The winning terminal
finalizer releases only a lease whose `run_id`, owner, and status still match;
replay does not rewrite `releasedAt`, except to repair a legacy acquired leak
using the already-persisted completion time. Terminal draining is scoped to the
released repository group. Lease expiry is derived from
`budgets.maxRunMinutes`.

`retryPolicy.maxAttempts` counts the initial attempt. Fixed backoff is
`min(initialSeconds, maxSeconds)`; exponential backoff is
`min(initialSeconds * 2^(completedAttempt - 1), maxSeconds)`. Retryable stage
failures keep the failed step evidence, release the lease, and receive a future
eligibility time. The attempt increments only when a supervisor tick leases the
due work. Stage promotions and linked runs consume the same dispatch-attempt
budget. No hosted polling cadence is implied by this ADR.

Reconciliation-authored `stalled` and `timed_out` outcomes preserve the source
run as terminal and create a new trace-linked run from planning. The child
inherits an immutable trigger snapshot, records `retryOfRunId`, and increments
the dispatch attempt. Cancellation, success, and untyped terminal failure do
not create linked retries.

Admission primitives are loop-agnostic, while issue #96 integrates the complete
lease and retry lifecycle only for the development loop. Research-loop durable
transitions and enforcement require a separate M9 story.

## Consequences

- Restarts do not erase capacity ownership or retry eligibility.
- Database row locks and uniqueness constraints, rather than process locality,
  serialize competing dispatchers.
- Terminal retry history is represented as linked immutable runs, increasing
  row count while improving forensic clarity.
- Operators must reconcile an expired owner before its capacity is reusable.
- Missing lease evidence is unknown and fails open; released or expired lease
  evidence is inactive. Queued acquired owners participate in reconciliation,
  while queued deferred work does not.
- Migration preflight fails closed when historical active duplicates exist.
  Operators must inspect and terminalize the losing rows before retrying the
  migration; the migration never guesses which forensic record to mutate.
- A production scheduler may call the injected-clock supervisor, but its cadence
  remains an explicit future hosting decision.

## Validation

1. PGlite integration tests cover deferral, contention, queue order, terminal
   release, restart-equivalent reads, retry timing, exhaustion, and trace links.
2. Migration tests apply and replay the schema, including the duplicate-active
   preflight and partial unique index.
3. Static observability tests keep dispatch and retry spans and metrics behind
   central helpers with bounded attributes.
4. A native PostgreSQL lane (`bun run test:integration:postgres`) overlaps two
   independent backends against one migrated database and proves the group
   guard serializes admission: the losing session is observed waiting on a lock
   in `pg_stat_activity` while the winner holds its pre-commit transaction, and
   only one lease is acquired under `maxInFlight: 1`. The same overlap proves
   cross-loop issue exclusivity yields typed contention rather than a raw
   uniqueness error. The lane fails closed when no safe local database is
   configured; it never skips and never falls back to PGlite.

## Follow-Ups

- Draft an M9 story titled “Research-loop durable transitions, reconciliation,
  lease lifecycle, and retry enforcement.” Do not create it without maintainer
  authorization.
- Done (issue #101): the real-Postgres multi-session admission lane described in
  Validation now covers production lock-wait behavior.
