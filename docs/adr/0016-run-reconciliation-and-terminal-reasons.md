# ADR 0016: Run Reconciliation And Terminal Reasons

Status: Proposed
Date: 2026-07-22

Driving issue: [#95](https://github.com/ncolesummers/loopworks/issues/95)

## Context

Development runs can remain `running` after agent silence, host termination, or
backing-issue changes. Current persistence records only a broad run status and
an optional untyped metadata reason. The database also has no durable execution
lease yet; that dispatch-side contract belongs to issue #96.

Reconciliation needs deterministic time, typed terminal evidence, read-only
tracker refresh, and an execution-liveness seam that does not guess from queued
or running step status.

## Decision

Each loop manifest declares a positive `reconciliation.silenceThresholdSeconds`
value. A reconciliation pass reads active Postgres runs, refreshes their GitHub
issues without mutation, and resolves cancellation policy before execution
health. The precedence is tracker or manifest cancellation, inactive execution,
silent active execution, then healthy.

`loop_runs.terminal_reason` uses the typed values `succeeded`, `failed`,
`timed_out`, `stalled`, and `canceled_by_reconciliation`. The terminal finalizer
derives the broader run status, uses a compare-and-set transition, persists one
correlated completion event, and emits the existing run completion and duration
metrics only for the winning transition.

Health-authored finalization revalidates the current stage, current step, and
latest relevant activity immediately before the terminal transition. Queued
future stages do not count as activity. A changed snapshot remains active so a
reconcile pass cannot terminate work that progressed during tracker refresh.

Execution liveness is injected as `active`, `inactive`, or `unknown`. Unknown
liveness fails open. Reconciliation never infers host liveness from step status;
issue #96 may later implement this boundary with durable dispatch leases.

## Consequences

Runs gain durable, queryable failure taxonomy and deterministic reconciliation
without widening this issue into scheduling or dispatch. Replays and concurrent
passes are safe, and GitHub remains a read-only source during reconciliation.

Until issue #96 supplies durable lease-backed evidence, callers must provide a
trustworthy liveness source. An unavailable source preserves the run and
surfaces an explicit unknown outcome. Existing step rows remain unchanged as
forensic evidence when the owning run is finalized.

## Validation

1. Manifest tests reject missing or non-positive silence thresholds.
2. Migration replay and PGlite tests cover typed terminal reasons.
3. Reconciliation tests independently cover healthy, stalled, timed-out,
   canceled, continued-policy, tracker-failure, and unknown-liveness outcomes.
4. Concurrent finalization produces one durable event and one metric emission.
5. Race tests reject stale health evidence, and store tests exclude queued
   future-stage timestamps and non-development loops.
6. Static observability tests keep metric and span names behind shared helpers.

## Follow-Ups

1. Issue #96 provides durable dispatch leases and backs the liveness boundary.
2. Issues #66 and #67 may project terminal reasons into dashboards and alerts.
