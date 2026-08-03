# ADR 0019: First-Run State Model and Onboarding IA

Status: Proposed
Date: 2026-08-02
Issue: [#123](https://github.com/ncolesummers/loopworks/issues/123)
Parent epic: [#122](https://github.com/ncolesummers/loopworks/issues/122)

## Context

Portal reads describe their origin with `PortalRecordsResult.source`: `"db"`,
`"fixtures"`, or `"unavailable"`. Onboarding absence and an unavailable data
source require opposite operator responses, so the first-run contract must keep
them distinct.

The MVP activation journey includes installing the GitHub App, selecting a
repository, and registering a loop. Producing a run is not part of activation.
Issue #124 adds the independent `github_installations` record required to
represent the installation step without implying that repository selection has
already happened. The older nullable `repositories.installationId` remains a
repository projection rather than the onboarding source of truth.

An installation signal derived from repository rows would make the repository
stage unreachable by construction: `installationCount > 0` would imply
`repos.length > 0`. The existing `sso` `GitHubSettingRecord` has the identical
defect because it is enabled when some repository row has a non-null
`installationId`. A truthful installation stage requires an installation record
whose existence is independent of repository selection.

## Decision

Define a server-derived `FirstRunState` with three ordered, first-match-wins
onboarding stages:

1. `no-installation`
2. `no-repositories`
3. `no-loops`
4. `activated`

All onboarding stages are reachable from real `readPortalRecords` output. Zero
installation rows select `no-installation`. With an installation present, zero
repository rows produce `records.repos.length === 0` and select
`no-repositories`. One or more repository rows with zero loop rows produce
`records.repos.length > 0` and `records.loops.length === 0`, selecting
`no-loops`. Populated repositories and loops produce `activated`.

`no-installation` reads `PortalRecords.githubInstallations`, which is projected
from the independent installation table by the existing portal-record read.
`FirstRunState` still reads only the `PortalRecordsResult` it is handed and adds
no query of its own.

Derive the state server-side for each portal read. Never persist or compute it
on the client. There is no completion flag, dismissal, or snoozing. At the model
boundary, deleting the last repository returns the operator to
`no-repositories`, and deleting the last loop while retaining a repository
returns the operator to `no-loops`.

Compose the state with `source` before inspecting records. An `"unavailable"`
result short-circuits to `{ reason, status: "unavailable" }`. Current fixture
records are fully populated, so `source: "fixtures"` computes `activated`.

The activated arm exposes `hasRunActivity`, derived from
`records.timeline.length > 0`. The timeline contains steps from one preferred
run; it is not a run count. An operator may have runs but still read
`hasRunActivity: false` when that preferred run recorded no steps.

Give all three union arms optional `never` exclusions for fields owned by the
other arms. The exclusions reject conflated values carrying a real reason or
stage, but do not reject an explicit `undefined`. The repository does not enable
`exactOptionalPropertyTypes`, and enabling it currently exposes approximately
93 pre-existing errors, so that compiler change is a separate migration.

Therefore, `status` is the only safe discriminant. The module exports
`isFirstRunUnavailable`, `isFirstRunOnboarding`, and `isFirstRunActivated` as
the supported narrowing API. Consumers must not use property-presence checks
such as `"reason" in state`, which can be true on an onboarding value carrying
`reason: undefined`.

Keep the production `hasRequiredPortalData` gate for existing operational
pages, but let Settings request `allowEmpty: true`. A successful empty database
read can therefore render the installation action, while a failed read remains
`source: "unavailable"` and cannot render a connection call to action.

Issue [#127](https://github.com/ncolesummers/loopworks/issues/127) still owns
the coordinated relaxation and actionable routing for the remaining portal
empty states.

All work in epic #122 must obey this routing rule: an actionable empty state
must route to the step it names.

## Consequences

Consumers receive a typed contract that separates unavailable, onboarding, and
activated states. The `?: never` exclusions reject non-fresh conflated values
when the excluded property has a real value, but explicit `undefined` remains
assignable until `exactOptionalPropertyTypes` is enabled. Consumers must narrow
with `status` or the exported guards, never property presence.

Server-side, per-read derivation keeps the model aligned with current records
and intentionally allows repository or loop removal to re-enter onboarding.
It does not create durable onboarding progress or override the unchanged
production availability gate.

Fixture/dev mode cannot exercise onboarding stages while it uses the fully
populated `portalFixture`; it always computes activated. Focused component and
PGlite tests cover disconnected Settings state, while Issues #125 through #128
must account for the same fixture limitation.

`hasRunActivity` is intentionally weaker than an authoritative run signal. It
cannot distinguish no runs from a preferred run with no recorded steps and
must not be used as a run count, audit fact, or durable completion claim.

## Validation

`tests/unit/onboarding/first-run-state.test.ts` covers all onboarding stages,
the installation/repository/loop boundaries, activated states with and without run
activity, unavailable ordering and exact reason propagation, and fixture
activation. Its non-fresh assignability tests prove that onboarding cannot carry
a real unavailable reason and unavailable cannot carry a real onboarding stage;
removing the `?: never` exclusions makes their `@ts-expect-error` directives
unused and fails typecheck. Guard tests cover every union arm and document why
property-presence narrowing remains unsafe without
`exactOptionalPropertyTypes`.

`bunx biome check src/lib/onboarding tests/unit/onboarding`,
`bun run typecheck`, the focused onboarding and unchanged portal test suites,
`bun run check`, and `bun run markdownlint` verify the implementation and
documentation contracts.

Updated for [#134](https://github.com/ncolesummers/loopworks/issues/134): this
work originally ran `bun run format:check` and `bun run lint`, which surfaced
the gap that neither runs Biome assists. `bun run check` replaced both in
`validate`, and is the command to run here.

## Follow-Ups

- Track and enable `exactOptionalPropertyTypes` as a separate repo-wide
  migration so the `?: never` exclusions also reject explicit `undefined`;
  approximately 93 existing errors must be resolved first.
- [#124](https://github.com/ncolesummers/loopworks/issues/124): implemented the
  independent installation record, truthful `no-installation` stage, and the
  Settings-specific successful-empty read path; acceptance remains pending
  review and aggregate validation.
- [#125](https://github.com/ncolesummers/loopworks/issues/125): implement
  repository selection.
- [#126](https://github.com/ncolesummers/loopworks/issues/126): implement first
  loop registration.
- [#127](https://github.com/ncolesummers/loopworks/issues/127): implement
  actionable empty-state routing and atomically consume the relaxed production
  gate.
- [#128](https://github.com/ncolesummers/loopworks/issues/128): validate the
  day-zero journey, including fixture/dev-mode coverage.
- Revisit `hasRunActivity` when portal records expose an authoritative run
  signal.
- Move this ADR from Proposed to Accepted after review.
