# ADR 0033: Persona Journey Registry

Status: Proposed
Date: 2026-08-15

Driving issue: [#241](https://github.com/ncolesummers/loopworks/issues/241)

## Context

`docs/personas-and-test-scenarios.md` defines 23 stable persona scenario IDs.
Exactly one of their properties is machine-readable: membership in
`personaTestIdValues` (`schemas/loop-manifest.ts`), held in parity with the
document by `tests/unit/loops/manifest.test.ts`. That parity proves the
vocabulary is consistent. It proves nothing about what a scenario does, which
surfaces it touches, or whether anything covers it.

The consequence is measurable. There are five specs in `tests/e2e/` against 23
documented scenarios, and no artifact reports that gap. A scenario ID can be
cited by the backlog, described in the matrix, and have no executable meaning
anywhere.

Three queued issues depend on answering those questions mechanically: #242
builds per-journey fixture worlds, #201 provisions persona test sessions, and
issue #243 writes the remaining browser journeys. Each needs to know which
journeys exist, what state each requires, and which surfaces each touches —
before it can start.

## Decision

Add `loopworks.persona_journey.v1` as a versioned, schema-validated registry in
`schemas/persona-journey.ts`, following the Zod-source pattern already
established by `schemas/loop-manifest.ts`.

**The registry is the executable projection of the narrative.** The persona
document remains the product story and is not modified. The registry carries
what a machine must answer: per journey, a stable `journeyId`, scenario IDs,
goal, complete start and end state, affected surfaces and allowed relative
routes, opaque fixture-world and session-profile references, ordered actions,
observable checkpoints, functional/keyboard/accessibility expectations,
viewport and theme variants, declared mutations, and bounded budgets. Drift
between the registry and the persona matrix fails CI once the coverage layer's
parity gate lands.

Budgets, viewports, themes, surfaces, and mutations are closed enums or bounded
numbers rather than free text. An unbounded budget cannot fail a journey that
runs too long, and an open surface vocabulary cannot support the changed-surface
expansion #244 needs. The mutation vocabulary deliberately offers no value for
an external GitHub or Vercel write, making a non-deterministic journey
unrepresentable rather than merely discouraged.

Journey sessions are an explicit discriminated union of `unauthenticated` and
`persona_fixture`. P06 and S07 are unauthenticated scenarios; declaring the
absence of a session directly avoids a sentinel profile ID that #201 would then
have to special-case.

**Derivable facts are derived, not declared.** The driving issue asks for
"persona test IDs and source scenario IDs", but in this repository those are one
vocabulary: `personaTestIdValues` holds scenario IDs, and the persona role is
recoverable from the ID prefix. Storing the role beside the IDs would create a
second place for one fact to be wrong, so the registry stores only
`personaTestIds` and exposes `personaRolesForScenarioIds`. The prefix mapping is
asserted total over the ID vocabulary and surjective onto the role list. That
gives #244 its persona dimension without a field that can disagree.

Cleanup follows the same rule. An earlier revision carried a `resetExpectation`
field, then pinned it to `mutations` with a refinement — at which point its only
possible values were the derived one and a CI failure. Worse, the two available
tokens collapsed database and browser-storage cleanup into one, so P04, which
writes only browser storage, would have had to instruct #242 to reset a fixture
world it never touched. `journeyCleanupForMutations` derives the distinct
obligations instead, and the field is gone.

`allowedRoutes` accepts query strings, fragments, and dynamic segments, because
the scenarios this registry must describe already use them —
`/settings?github=cancelled` in the day-zero walk and
`/sign-in?error=AccessDenied` for S07. It rejects absolute URLs,
protocol-relative URLs (including bare `//`, which `new URL` cannot parse), and
traversal.

Percent-encoding is permitted in the query and refused in the path. A
literal-dot traversal guard is worthless if the author can spell the dots as
`%2e`: `new URL("/%2e%2e/admin", base)` resolves to `/admin`, so the declared
route and the navigated route would be different paths. No product route needs
an encoded path segment, and the query still needs encoding to express values
like `callbackUrl=%2F`. The rejection lives inside the regex rather than in a
`.refine()` for the reason below.

**The mirror is a structural subset, and says so.**
`z.toJSONSchema` drops refinements silently, with no warning and no throw. A
guard written as `.refine()` would therefore be enforced by Zod and absent from
the mirror, leaving two artifacts that disagree about what is valid while the
freshness check stays green. Single-field constraints are expressed as regexes
and bounds so they survive generation, and differential tests compare the
mirror's emitted patterns, numeric bounds, and `uniqueItems` flags against the
Zod source — the route check over a corpus of real and hostile routes, because
that is where the constraint is most intricate.

Uniqueness over arrays of scalars is included in that set. `uniqueItems` is a
core JSON Schema keyword and Zod emits it from `.meta()`, though `.meta()` alone
does not validate — so `uniqueArray` pairs a refinement that enforces with
metadata that mirrors. An earlier revision asserted that uniqueness could not be
expressed in JSON Schema at all and routed every such check through a refinement
the generator drops. That was simply wrong, and it made the mirror weaker than
it needed to be for the largest group of constraints in the contract.

What genuinely cannot be expressed is uniqueness keyed on an object property
(`actions[].id`, `checkpoints[].id`, `journeys[].journeyId`,
`coverage[].scenarioId`) and the remaining cross-field rules: `none` exclusivity,
action-surface containment, actions against `budgets.maxActions`, and the
unauthenticated-write prohibition. Those are enforced in Zod, and the mirror's
`$comment` tells a reader holding only the JSON that a document it accepts may
still be rejected. That caveat lives in the artifact rather than a prose array in
the source: no test can bind such a list to the refinements it names, and an
unbindable list goes stale silently.

**Coverage classification lives in the registry, not the document.** Every
stable scenario carries exactly one classification: `browser_journey` naming
resolvable journey IDs, `deterministic_non_browser` naming covering test paths
that exist on disk, or `not_applicable` with a written rationale. Each kind
carries its own evidence, so a classification is checkable rather than an
unfalsifiable claim.

Two distinct mechanisms enforce "exactly one". A single entry mixing two kinds'
keys is rejected by `.strict()` on each union member. A scenario classified
twice across two separate entries is rejected by a registry-level refinement,
because `.strict()` cannot see across array elements. Exhaustiveness — that
every documented scenario appears at all — cannot be expressed in the schema,
which cannot know the document's scenario list; it is enforced by a parity gate
that extends the existing persona parity test rather than duplicating it.

**The JSON mirror is generated, not hand-maintained.** Zod 4 provides
`z.toJSONSchema()`, so `schemas/persona-journey.v1.schema.json` is produced by
`scripts/sync-schemas.ts` behind `--write` / `--check`, matching the
`agent-docs:check` and `config:check` pattern, and `schemas:check` runs inside
`validate`. `schemas/loop-manifest.schema.json` stays hand-maintained; its
conversion is #106, and rewriting it here would touch a file several unrelated
tests assert against.

### Deliberately excluded

Fixture-world construction, seeding, and reset are #242. Persona principals and
session provisioning are #201. Playwright journeys are #243. Test-plan binding
and the deterministic selection artifact are #244 in M7.

The registry therefore references `fixtureWorldId` and `sessionProfileId` values
that do not resolve to anything yet. That is intended: declaring the reference
now is precisely what lets those siblings be built against a fixed target
instead of inventing one. Resolution is their gate, not this one's.

Personas remain test lenses. This ADR creates no production RBAC semantics and
no permission differences between personas.

## Consequences

Once the coverage layer lands, a scenario can no longer be silently uncovered:
adding a row to the persona matrix fails CI until it is classified, and
classifying it as a browser journey fails CI until a journey with that ID
exists. This ADR is delivered as a stack, and those gates arrive with its
coverage layer rather than with the contract — see Validation for what holds at
each point.

The registry is a second place to edit when a journey changes, and its entries
describe intent that nothing executes until #242 and #243 land. Between now and
then, a registry entry can be wrong in ways only a human reviewer catches — the
parity gates prove references resolve, not that a journey describes the product
accurately.

The surface vocabulary is closed, so a new route requires a schema change before
a journey can reference it. That is the intended cost of making changed-surface
expansion possible later.

## Validation

With the contract layer:

- Schema tests cover accepted entries, rejected free-text budgets at both
  bounds, unknown viewports and themes, unknown persona IDs, unknown keys,
  empty required collections, blank text, and the unauthenticated-session case.
- Route tests assert every URL shape the product's existing specs drive is
  expressible, and that absolute, protocol-relative, and traversal routes are
  not.
- A differential test compares the mirror's emitted route pattern against the
  Zod source over that same corpus, so a constraint moving back into a dropped
  refinement fails rather than passing a freshness check.
- Coherence tests reject contradictory declarations: `none` beside a write, an
  unauthenticated database write, an action on an undeclared surface, more
  actions than the action budget, duplicates in every declared collection,
  duplicate journey IDs, and a scenario classified twice.
- Derivation tests cover persona roles and cleanup obligations, and prove the
  registry rejects a stored persona field.
- The generated mirror is asserted byte-identical to a fresh generation, carries
  a do-not-edit marker and the versioned contract ID, and `schemas:check` is
  demonstrated failing against a hand-edited mirror. `schemas:check` runs in
  both `validate` and CI.
- `bun run validate` and `bun run build` pass.

With the coverage layer, additionally:

- Parity gates are demonstrated failing for an unclassified scenario, a
  scenario classified twice, and a `browser_journey` naming an unknown journey.

## Follow-Ups

- #242 resolves `fixtureWorldId` to composable fixture packages.
- #201 resolves `sessionProfileId` to credential-free persona test sessions.
- #243 delivers the remaining browser journeys against complete fixture worlds.
- #244 binds test plans to journeys and emits the selection artifact (M7).
- #106 may convert `schemas/loop-manifest.schema.json` to the same generated
  mirror once its hand-maintained assertions are reworked.
