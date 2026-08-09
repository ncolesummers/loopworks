# ADR 0019: First-Run State Model and Onboarding IA

Status: Proposed
Date: 2026-08-02
Issue: [#123](https://github.com/ncolesummers/loopworks/issues/123)
Parent epic: [#122](https://github.com/ncolesummers/loopworks/issues/122)
Updated by: [#126](https://github.com/ncolesummers/loopworks/issues/126)

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
`no-repositories`. One or more repository rows with zero registered loop
definitions produce `records.repos.length > 0` and
`records.registeredLoops.length === 0`, selecting `no-loops`. Populated
repositories and registered loop definitions produce `activated`. GitHub issue
mirror rows in `records.loops` do not affect onboarding.

`no-installation` reads `PortalRecords.githubInstallations`, which is projected
from the independent installation table by the existing portal-record read.
`FirstRunState` still reads only the `PortalRecordsResult` it is handed and adds
no query of its own.

Derive the state server-side for each portal read. Never persist or compute it
on the client. There is no completion flag, dismissal, or snoozing. At the model
boundary, deleting the last repository returns the operator to
`no-repositories`, and deleting the last registered loop definition while
retaining a repository returns the operator to `no-loops`.

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

A successful empty database read must render the installation action, while a
failed read stays `source: "unavailable"` and cannot render a connection call to
action. That distinction is the durable decision here, and it holds.

The original mechanism does not. This ADR first specified a global
`hasRequiredPortalData` gate with an `allowEmpty: true` opt-out for Settings.
Because that gate required repositories, loops, deployments, an approval, and
settings to *all* be non-empty, and loop registration
([#126](https://github.com/ncolesummers/loopworks/issues/126)) leaves `loops`
empty on every fresh install, one empty collection discarded every record — so
`/`, `/catalog`, `/loops`, and `/approvals` reported "Unavailable" against a
healthy store. Amended by
[#155](https://github.com/ncolesummers/loopworks/issues/155):

`getPortalRecordsForPortal` takes a required
`requires: readonly PortalDataRequirement[]`, replacing `allowEmpty`. In
production a surface fails closed only for collections it declared it cannot
render without. The field is mandatory rather than optional so a new caller
cannot silently opt out of failing closed; `[]` is an explicit declaration that
the surface renders its own empty state. Every surface declares `[]` today,
because each has a real empty state.

What separates "store unavailable" from "store healthy but empty" is therefore
the failed-read path — a throwing or misconfigured read still returns
`source: "unavailable"` — plus any requirement a surface declares. Nothing else
gates a production read.

An earlier revision of this work also ran a settings-projection integrity check
at production runtime. It was removed: `mapSettings` maps over the same key list
the check validates, so the compiler already guarantees the contract and the
runtime check could only ever misfire, reporting a healthy store as unavailable
on every surface at once — the failure #155 exists to fix.
`hasPortalProjectionIntegrity` remains as a predicate asserted by tests over
real reads, which catches a projection regression in CI instead of production.

One silent failure remains out of scope and unaddressed: a store that answers
successfully with data from the wrong or freshly-reset database is
indistinguishable from a new install, and renders as "Live database" with empty
collections. The superseded global gate caught that case only incidentally, by
also breaking every legitimate fresh install — which is the defect #155 exists
to fix. Detecting it needs store-identity evidence rather than row counts, and
is not solvable inside this read. Tracked as
[#158](https://github.com/ncolesummers/loopworks/issues/158).

Issue [#127](https://github.com/ncolesummers/loopworks/issues/127) retains
actionable routing for the portal empty states this relaxation now makes
reachable.

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
the installation/repository/registered-loop boundaries, the separation from
synced issue loops, activated states with and without run activity, unavailable
ordering and exact reason propagation, and fixture activation. Its non-fresh
assignability tests prove that onboarding cannot carry
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
- [#125](https://github.com/ncolesummers/loopworks/issues/125): implemented
  repository selection at `/settings/repositories`. Selection writes identity
  fields into `repositories`, so the `no-repositories` boundary this ADR models
  is now reachable from operator action rather than only from seeded data.
  Deselection hard-deletes the row, matching this ADR's boundary statement, but
  the store refuses when the repository still has `loops` or `loop_runs` rows so
  the cascade never silently destroys run history.
  `tests/unit/github/repository-selection.integration.test.ts` asserts both
  boundary crossings through `readPortalRecords` and `deriveFirstRunState`. The
  fixture limitation this ADR records still holds: `dev:fixture` cannot exercise
  the onboarding transition, so the page serves an explicit, non-production
  `repositorySelectionFixture` for Playwright and Storybook coverage while the
  transition itself is proven by PGlite tests. Acceptance remains pending review
  and aggregate validation.
- [#126](https://github.com/ncolesummers/loopworks/issues/126): implemented first
  loop registration with a durable `loop_definitions` store, a registration
  surface at `/loops/register`, and a registered-loop projection distinct from
  synced issue loops. `no-loops` now reads that registered projection. Fixture
  mode remains read-only, so PGlite and route tests prove the write and
  transition while Playwright covers the operator surface. Acceptance remains
  pending review and aggregate validation. See ADR 0025.
- [#127](https://github.com/ncolesummers/loopworks/issues/127): implemented
  actionable empty-state routing, and is the first UI consumer of
  `deriveFirstRunState`. The portal pages previously collapsed all three sources
  into one optional `emptyDetail` string, so a healthy-but-empty store and a
  failed read rendered the same shell and only the registered-loop registry
  decoded that convention. `/` and `/catalog` now derive the state server-side
  and pass a typed `firstRun` prop; `/loops` passes it to the registered
  registry and keeps `emptyDetail` only for the synced-issue mirror, whose
  emptiness no onboarding stage explains.

  `src/components/portal/empty-states.ts` holds the portal's empty-state
  inventory. Its `PortalEmptyStateSpec` type makes "neither an action nor a
  stated terminal reason" unwritable, so the routing rule above is enforced by
  the compiler rather than by review, and
  `tests/unit/portal/empty-state-inventory.test.ts` fails any portal component
  that renders empty-state markup without going through the registry.
  `resolvePortalEmptyState` composes `source` with the onboarding stage in the
  order this ADR requires, narrowing on `status` only, and takes the stages a
  surface can honestly speak to so a stage is never reported as the cause of an
  emptiness it does not cause — the catalog omits `no-loops`, which implies
  repositories already exist.

  Two rules fell out of review and are now enforced by the inventory test. An
  empty state that offers `/api/github/install` must offer
  `/api/github/install/reconcile` beside it, because GitHub dead-ends the
  install link for an account that already has the App
  ([#151](https://github.com/ncolesummers/loopworks/issues/151)) — an install
  action alone is exactly the dead end this issue removes. And an action that
  cannot render an affordance — a filter reset with no handler, an external href
  the allowlist rejects — is not treated as an action, so "actionable" always
  means an affordance the operator can actually see and use.

  Not covered: the two-theme axe sweep runs against populated fixture routes, so
  it never has a first-run or unavailable empty state on screen. Fixture mode is
  fully populated, as this ADR already records, so reaching those states in
  Playwright needs fixtures that do not exist yet. That belongs to
  [#128](https://github.com/ncolesummers/loopworks/issues/128).

  Acceptance remains pending review and aggregate validation.
- [#128](https://github.com/ncolesummers/loopworks/issues/128): validate the
  day-zero journey, including fixture/dev-mode coverage.
- Revisit `hasRunActivity` when portal records expose an authoritative run
  signal.
- Move this ADR from Proposed to Accepted after review.
