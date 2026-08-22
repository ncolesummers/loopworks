# ADR 0019: First-Run State Model and Onboarding IA

Status: Accepted
Date: 2026-08-02
Accepted: 2026-08-13 after parent epic
[#122](https://github.com/ncolesummers/loopworks/issues/122) review and closure
and [PR #223](https://github.com/ncolesummers/loopworks/pull/223) merge
Issue: [#123](https://github.com/ncolesummers/loopworks/issues/123)
Parent epic: [#122](https://github.com/ncolesummers/loopworks/issues/122)
Updated by: [#126](https://github.com/ncolesummers/loopworks/issues/126),
[#155](https://github.com/ncolesummers/loopworks/issues/155),
[#158](https://github.com/ncolesummers/loopworks/issues/158)

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
onboarding stages followed by the terminal `activated` state:

1. `no-installation`
2. `no-repositories`
3. `no-loops`
4. `activated` (terminal state, not an onboarding stage)

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

One silent failure was left out of scope by #155 and is now closed by
[#158](https://github.com/ncolesummers/loopworks/issues/158): a store that
answers successfully with data from the wrong or freshly-reset database was
indistinguishable from a new install, and rendered as "Live database" with empty
collections. The superseded global gate caught that case only incidentally, by
also breaking every legitimate fresh install — which is the defect #155 exists
to fix. Detecting it needs store-identity evidence rather than row counts, so
row counts are not what answers it.

A singleton `store_identity` row records the identity of the store itself,
issued by migration `0003` when the database is created and reissuable with
`bun run db:provision`. Hosted reads compare it against
`LOOPWORKS_EXPECTED_STORE_ID` before reading anything else, and a store that
does not verify returns `source: "unavailable"` with the distinct error
`Portal data store identity is unverified.` Three states fail closed and are
separated in the structured log event `portal_store_identity_unverified` by an
`identityStatus` field: `mismatch` (another database answered), `unprovisioned`
(the expected one was emptied), and `not_configured` (the deployment never
declared which store to expect). Only digests of the two identifiers are
logged, never the identifiers themselves.

Three properties of that decision are load-bearing:

- **Hosted Production and Preview.** Development and the fixture and seeded
  lanes are not production runtimes. ADR 0035 gives Preview one fixed,
  disposable database with a distinct configured identity, so Vercel Preview
  now follows the same fail-closed read gate as Production. This proves the
  deployment reached its named store; it does not prove freshness or replace
  the separate-project and no-Production-data operator checks.
- **Checked before the read**, because there is nothing worth reading from a
  store that cannot be identified.
- **Never reissued over an existing identity.** Provisioning a store that
  already has one is a no-op, so an emptied database cannot quietly re-earn the
  trust the wipe should have cost it.

Because the row lives in `public`, a truncate of the schema takes it too. That
is deliberate: it is what makes "provisioned, then emptied" observable instead
of silent. The reset procedure in
`docs/runbooks/github-repository-selection-verification.md` names three tables
rather than the whole schema, so it leaves the identity intact and a
deliberately emptied expected store still renders its own first-run empty
states — which remains the correct reading of that operator action.

### What this does not catch

The mechanism proves a store is *the one named*, not that it is current. Three
gaps are known and accepted rather than overlooked:

- **A branch or restore of the same database carries the identity row with it.**
  Neon branching copies data, so pointing production at a stale branch of itself
  verifies clean. On this stack that is arguably the most plausible wrong
  database, and no comparison of a copied value can detect it. Only a database
  built from scratch gets a new identity.
- **Reads outside the two gated functions.** `getPortalRecordsForPortal` and
  `getRunRecordsForPortal` cover the six navigable portal surfaces.
  `/settings/repositories` and `/loops/register` read through the GitHub
  repository-selection runtime instead, and still render their own
  connect-the-App affordance against an unverified store.
- **Writes.** The gate is read-side only. `/api/github/webhooks`, the
  installation callback, repository apply, and approval transitions still write
  to whatever store answers.

The first is inherent to identity-by-comparison. The other two are scope: #158
asks that a production *read* not render as a normal empty state and that
`/settings` not offer the connect action, and both hold. Extending the boundary
to the selection runtime and the write paths needs its own issue, because each
needs an error contract of its own rather than a shared "unavailable" record
shape.

`LOOPWORKS_EXPECTED_STORE_ID` remains runtime-verified for Production to
preserve its rollout ordering. ADR 0035 adds a target-specific Preview writer
contract that requires a distinct value before any Preview value is sent to
Vercel. In either hosted environment, an unset value fails closed as
`not_configured`; the deployment runbook makes reading and setting it part of
the rollout.

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

`tests/unit/portal/store-identity.test.ts` covers the four verification states
over a real store, that a re-run cannot reissue an identity, and that only
digests leave the module. `tests/unit/portal/pages-production-gate.test.tsx`
renders all five surfaces through the real production gate three ways —
provisioned and matching, pointed at another store, and emptied — so the case
that must still render its own empty states and the two that must not are
asserted side by side. That suite mints its expected identity from the store
rather than sharing a literal with the environment fixture, so the fresh-install
case cannot pass by construction. Its Settings cases prove the connect-the-App
action is absent whenever the identity is unverified.

`tests/unit/portal/portal-records.test.ts` covers the log events, that a
verified store stays silent, that raw identifiers never reach the log, that
non-production bypasses the check, and that Preview fails closed on a mismatch.
`tests/unit/runs/run-record.test.ts` covers the same gate on `/runs`, which
reads through a different function. `tests/unit/scripts/provision-store-identity.test.ts`
covers the recovery CLI.

Two tests exist because their absence would let a silent regression through:
one reads a freshly migrated database to prove migration 0003's hand-added
`INSERT` provisions anything at all — every other suite truncates and re-inserts
by hand, so deleting that line would otherwise leave the suite green — and one
drops the identity table to prove a database that never ran the migration is
reported as `unreadable` rather than as a generic outage.

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

### #122 validation evidence

The following validation checks for [#122](https://github.com/ncolesummers/loopworks/issues/122)
passed on the then-current `main`. PR #223 recorded this evidence before the
epic was closed as completed.

- `bun run validate` — 133 Vitest files / 1,098 tests, Storybook build, security
  scanners, and 34 Playwright tests.
- `bun run build` — exit 0.
- `DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" bun run test:e2e:seeded`
  — day-zero: 1 passed; seeded-postgres: 4 passed.

The seeded lane uses the dedicated local `loopworks_e2e` database and is
separate from `bun run validate`; its guarded reset/reseed behavior is
described above and in `docs/development.md`.

## Follow-Ups

- Track and enable `exactOptionalPropertyTypes` as a separate repo-wide
  migration so the `?: never` exclusions also reject explicit `undefined`;
  approximately 93 existing errors must be resolved first.
- [#124](https://github.com/ncolesummers/loopworks/issues/124): implemented the
  independent installation record, truthful `no-installation` stage, and the
  Settings-specific successful-empty read path. The child issue is closed; the
  remaining challenge-retention and identity-hardening work is tracked separately in
  [#140](https://github.com/ncolesummers/loopworks/issues/140) and
  [#203](https://github.com/ncolesummers/loopworks/issues/203).
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
  transition itself is proven by PGlite tests. The child issue is closed;
  [#145](https://github.com/ncolesummers/loopworks/issues/145) binds each live
  read and apply to the acting operator's installation access. Multi-installation
  policy, orphan handling, and large-installation scale remain separate
  follow-ups in [#146](https://github.com/ncolesummers/loopworks/issues/146)
  through [#148](https://github.com/ncolesummers/loopworks/issues/148).
- [#126](https://github.com/ncolesummers/loopworks/issues/126): implemented first
  loop registration with a durable `loop_definitions` store, a registration
  surface at `/loops/register`, and a registered-loop projection distinct from
  synced issue loops. `no-loops` now reads that registered projection. Fixture
  mode remains read-only, so PGlite and route tests prove the write and
  transition while Playwright covers the operator surface. The child issue is
  closed;
  registration ends at a persisted, visible loop by design, while triggering or
  executing a run remains out of scope. See ADR 0025.
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

  At the time of #127, the two-theme axe sweep ran against populated fixture
  routes, so it did not exercise a first-run or unavailable empty state. The
  seeded day-zero lane delivered by [#128](https://github.com/ncolesummers/loopworks/issues/128)
  now covers those states; this follow-up remains the owner of the inventory and
  actionability rules above.

  The child issue is closed; the seeded day-zero lane now covers the first-run
  and unavailable states described above.
- [#128](https://github.com/ncolesummers/loopworks/issues/128): implemented the
  day-zero walk (persona ids P05, M04, M05) that #127 left uncovered.
  `tests/e2e/day-zero-activation.spec.ts` runs in the seeded Postgres lane
  against a database emptied first, advancing one stage at a time through
  `scripts/seed-day-zero.ts`, so every onboarding stage of this ADR's state
  model is on screen for the two-theme axe sweep and for a per-step assertion
  that each rendered empty state's affordances resolve.

  Emptying is a truncate, not a delete of the fixture's own ids. First-run state
  is derived from whether *any* installation or repository row exists, so a
  single row left by an earlier run renders the walk's first step as an
  activated portal — delete-by-id cannot produce day zero. The destructive reset
  therefore lives in the guarded CLI, behind the same local-database guard the
  seeded lane already uses, never in `src/`.

  The walk found one gap in the shipped flow. `/` satisfied PRD UX requirement 9
  at `no-installation` and `no-repositories`, where the catalog panel names the
  step, but not at `no-loops`: the registered-loop registry that owns
  registration lives on `/loops`, so the first screen rendered an operational
  shell naming no next step at all, one step from the end of activation. The
  dashboard now states that stage itself, and only that stage — repeating a step
  a panel below already names would put the same landmark on the page twice,
  which the walk's axe sweep catches as `landmark-unique`. The PRD needed no
  amendment; the implementation did.

  Not covered: GitHub is stubbed at its boundary. Octokit has no base-URL seam
  and no test may reach the network, so installation and repository access
  arrive as fixture rows and `/settings/repositories` renders its unavailable
  state during the walk — asserted as a *failure*, per this ADR's
  unavailable-versus-empty distinction, rather than dressed up as a selection.
  Driving GitHub's own surfaces would need that seam plus a fake GitHub server;
  it is deliberately not part of this lane.
- Revisit `hasRunActivity` when portal records expose an authoritative run
  signal.
