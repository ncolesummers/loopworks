# Loop Orchestration Guide

## Scope

This guide applies to loop manifests, run creation and dispatch, durable stage
state, artifacts, approvals, retries, reconciliation, and loop-level telemetry
under `src/lib/loops/`.

Before changing the development-loop state machine, read
`transitions/AGENTS.md`. Read ADR 0006 for deterministic validation and TDD,
ADR 0014 for guarded GitHub PR writes, and ADRs 0014 through 0017 for the
current stage-orchestration, reconciliation, lease, retry, and finalization
contracts.

## Rules

1. Keep loop work issue-backed and acceptance criteria explicit. Write or
   update the smallest focused test first and record its failing state before
   changing runtime behavior.
2. Treat Postgres state as authoritative. Preserve transaction boundaries,
   compare-and-set guards, execution-lease ownership, idempotent replay, and
   inspectable failed-attempt evidence.
3. Keep model output outside the control plane until a typed contract has been
   parsed and every persisted binding has been revalidated.
4. Keep external writes behind explicit approval, digest binding, attribution,
   and deterministic reconciliation. Development mode must not construct live
   provider clients.
5. Use OpenTelemetry through the central logger, metrics, and trace helpers.
   Telemetry failure must never decide a durable transition, and attributes
   must remain bounded and free of secrets, prompts, tokens, and raw provider
   payloads.
6. Keep development-loop behavior in `transitions/`, reconciliation policy in
   `development-run-reconciliation.ts`, reconciliation persistence in
   `development-run-reconciliation-store.ts`, and loop-neutral admission
   primitives in the run/store modules that already own them.
7. Update the relevant ADR, contract documentation, or backlog item when a
   durable workflow expectation changes. A reversible file move with unchanged
   behavior does not require a new ADR.

## Tests

- Use focused Vitest suites for stage behavior, approvals, artifacts,
  telemetry, retry, and reconciliation.
- Use PGlite integration tests for transactional Postgres behavior. Use the
  native PostgreSQL lane when correctness depends on independent sessions or
  observable lock waiting.
- For a transition refactor, run the layout/export contracts, every affected
  stage suite, and the approval, dispatch, retry, reconciliation, and agent
  discovery regressions.

## Validation

Run focused tests while working. Before handoff, run `bun run check`,
`bun run typecheck`, and `bun run validate`; add `bun run build` when runtime
module boundaries or application imports changed.
