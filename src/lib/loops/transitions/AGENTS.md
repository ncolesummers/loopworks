# Development-Loop Transition Guide

## Scope

This guide applies to the stage-owned development-loop transition modules in
this directory. These modules control durable state-machine changes; a physical
refactor must preserve persistence, approval, retry, provider-write, and
telemetry behavior exactly.

## Stage Ownership

- `plan.ts`: plan artifact persistence and plan-review request binding.
- `test-writing.ts`: test-plan and red-evidence handoff.
- `implementation.ts`: production patch and green-evidence handoff.
- `validation.ts`: deterministic validation and screenshot-evidence results.
- `pr-preparation.ts`: evidence-bound PR preparation persistence.
- `validation-review.ts`: review persistence, bounded backward routes, and
  review history/retry decisions.
- `pr-stage.ts`: approval-gated development/live PR execution and PR-only
  metadata.
- `finalization.ts`: typed finalization, compatibility completion, scheduled
  stage retry, and direct step retry.
- `shared.ts`: cross-stage database and metric types, the single error class,
  lease guard, safe metric emission, duration/metadata helpers, approval scope,
  and validation-review history parsing.
- `index.ts`: the explicit public transition surface.

## Dependency Rules

1. Production callers import from `@/lib/loops/transitions`. Stage-focused
   tests may import the owning module directly so ownership failures are local.
2. `index.ts` uses explicit named exports. Do not use `export *`, add wrappers,
   or expose private helpers accidentally.
3. Define `DevelopmentLoopTransitionError` only in `shared.ts`; the barrel and
   every stage must share that runtime identity.
4. `shared.ts` must not import stage modules or `index.ts`. Stage modules import
   `shared.ts` or an owning module directly, never the barrel.
5. The only stage-to-stage dependency is `pr-stage.ts` importing scheduled
   retry from `finalization.ts`. Keep that edge one-way.
6. Keep validation-only calculations in `validation.ts`, PR-only metadata in
   `pr-stage.ts`, validation-review route/history mutation in
   `validation-review.ts`, and retry-reason normalization in `finalization.ts`.
7. Do not restore `development-run-transitions.ts`; the legacy import path is
   intentionally unsupported.

## TDD And Observability

1. Add or update the owning stage test before production code and capture the
   expected red assertion or module-resolution failure.
2. Preserve transaction boundaries and ordering, including work performed
   after provider writes and before retry scheduling or lease release.
3. Preserve metric names, attributes, span outcomes, structured log fields,
   trace propagation, and safe-emission behavior. Use the observability guide
   when changing telemetry rather than moving helpers ad hoc.
4. Any semantic state-machine change must be issue-backed and reconciled with
   ADRs 0014 through 0017; this directory layout is not authorization to redesign
   the workflow.

## Validation

- Run `tests/unit/loops/development-run-transition-layout.test.ts` and
  `tests/unit/loops/development-run-transition-exports.test.ts` for every
  ownership or public-surface change.
- Run the owning stage suite for local changes. For shared or finalization
  changes, also run approval, dispatch, retry, reconciliation, and agent
  discovery regressions.
- Before handoff, run `bun run check`, `bun run typecheck`, `bun run build`, and
  `bun run validate`.
