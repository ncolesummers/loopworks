# ADR 0025: Registered Loop Definitions

Status: Proposed
Date: 2026-08-08
Issue: [#126](https://github.com/ncolesummers/loopworks/issues/126)

## Context

The existing `loops` table is a projection of GitHub issues. Its fields describe
issue identity and planning state; it does not contain a loop key, enabled state,
repository scope, triggers, validation gates, approvals, or the rest of the
manifest contract. Treating those rows as registered loop definitions would
conflate backlog synchronization with an operator choosing an executable
contract.

Before #126, the only complete definition was the in-code
`defaultLoopManifest`. The portal could display that manifest, but there was no
durable write path that could complete the `no-loops` onboarding stage.

The registration surface needs actionable validation errors without introducing
a form-specific schema that can drift from the manifest accepted by runtime
admission.

## Decision

Store registered contracts in a distinct `loop_definitions` table. Each row is
owned by a tracked repository and has relational columns for identity, lookup,
enabled state, and timestamps. The validated `LoopDefinition` is stored as
`jsonb`. A unique constraint on repository and loop key prevents one repository
from registering two contracts under the same key.

Keep `loops` unchanged as the GitHub issue mirror. The `/loops` page presents
registered definitions and synced issue loops as separate registries so neither
storage model implies the semantics of the other.

Registration composes a complete version 1 manifest from the shipped
development-loop template, replacing only the operator-authored identity,
repository scope, trigger labels, and enabled state. It then calls the existing
`validateLoopManifest` boundary and persists `manifest.loops[0]`. Display paths
may remove the `loops[0].` prefix, but field messages and hints still come from
the manifest validator. There is no registration-specific Zod schema.

Repository identity and default-branch scope come from the tracked repository
row, not from client-submitted repository metadata. Registration never
overwrites an existing key. Repository deselection refuses while a registered
definition exists, preventing the foreign-key cascade from silently deleting a
live contract.

The registration API retains the existing session, tracing, structured logging,
and safe-reason boundaries used by other portal mutations. Fixture mode exposes
the surface but disables its submit control explicitly; real persistence and the
onboarding transition are verified through the migrated PGlite store and route
boundary.

## Consequences

The issue mirror and executable contract can evolve independently, and a synced
issue cannot accidentally complete onboarding. Persisting the exact validated
definition avoids a second field-by-field storage schema, while the relational
repository, key, and enabled columns keep ownership and common lookup constraints
enforceable by Postgres.

The `jsonb` value is governed by manifest validation at the write boundary.
Future manifest migrations must account for already-persisted definitions rather
than assuming every record has the latest in-code shape.

Every first-loop registration is a development-loop contract. Its concurrency
group is therefore canonicalized as `repo:{fullName}:loop:development` even when
the operator chooses a different display key, keeping development work for one
repository serialized under the shipped template's policy.

This slice displays the persisted enabled state but does not mutate it after
registration. Enable/disable requires an explicitly scoped update endpoint,
authorization and audit behavior, and tests for its effect on admission. Last-run
status is also outside the registered-definition contract delivered by #126.

Fixture-backed Playwright cannot prove a production write. It proves the
operator-facing route, states, keyboard behavior, responsive layout, and
accessibility; PGlite integration and route tests provide the deterministic write
evidence.

## Validation

- `tests/unit/loops/loop-definitions-schema.integration.test.ts` verifies the
  migrated table, defaults, uniqueness, and repository ownership.
- `tests/unit/loops/loop-registration.test.ts` proves registration composes a
  full manifest and reports errors through the existing manifest validator.
- `tests/unit/loops/loop-registration-store.integration.test.ts` and
  `tests/unit/loops/loop-registration-flow.test.ts` prove persistence,
  duplicate protection, tracked-repository ownership, and the deselection
  guard.
- `tests/unit/api/loop-registration.test.ts` verifies authentication, response
  outcomes, manifest validation, safe failure reasons, and the low-cardinality
  registration outcome metric added to ADR 0012.
- Portal, onboarding, Storybook, and Playwright coverage verifies the separate
  registry, first-run transition, fixture limitation, and registration states.
- `bun run validate` and `bun run build` are the aggregate delivery gates.

## Follow-Ups

- Define the enable/disable mutation, audit event, and admission behavior in a
  separately scoped issue before making the displayed state interactive.
- Decide how persisted definitions migrate when a future manifest version
  changes the `LoopDefinition` shape.
- [#128](https://github.com/ncolesummers/loopworks/issues/128) validates the
  complete day-zero journey across the activation surfaces.

Refs ADR 0004, ADR 0006, ADR 0019.
