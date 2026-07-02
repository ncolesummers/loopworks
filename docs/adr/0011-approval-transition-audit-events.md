# ADR 0011: Approval Transition Audit Events

Status: Proposed
Date: 2026-07-02

## Context

Issue [#12](https://github.com/ncolesummers/loopworks/issues/12) requires
approval gates that operators can inspect, transition, and audit. The existing
`approvals` table stored current state, but it did not preserve who moved a gate
from one status to another or when an exceptional bypass happened.

## Decision

Loopworks will keep `approvals` as the current-state row and add
`approval_transition_events` as the append-only audit record for approval status
changes. Every transition records the approval id, optional run id, previous and
next status, action, actor id, timestamp, note, and metadata such as auth mode.

`bypassed` is a persisted approval status. It is only reachable through the
`bypass` transition from `requested`, and it must include authenticated actor
attribution.

## Consequences

The portal can render a concise current approval state while preserving durable
review evidence for security review and later reconciliation. This avoids
overloading logs as the audit store and keeps approval transitions transactional
with the current-state update.

Bypass remains visible and auditable instead of being represented as a missing
approval or an ad hoc note.

## Validation

1. PGlite tests replay the migration and assert the audit table exists.
2. Approval API tests prove authenticated GitHub attribution updates the current
   approval row and inserts one transition event.
3. Seed data covers `requested`, `approved`, `rejected`, `cancelled`, `expired`,
   `applied`, and `bypassed` approval states.
4. Run UI tests show approval evidence with actor attribution.

## Follow-Ups

1. Move this ADR to Accepted after issue #12 review.
2. Add richer transition history UI once operators need to inspect more than
   the latest approval state.
