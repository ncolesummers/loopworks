# ADR 0021: Secure GitHub App Installation Callback

Status: Proposed
Date: 2026-08-02
Issue: [#124](https://github.com/ncolesummers/loopworks/issues/124)
Updated by: [#151](https://github.com/ncolesummers/loopworks/issues/151),
[#203](https://github.com/ncolesummers/loopworks/issues/203)

## Context

GitHub redirects to a GitHub App Setup URL with an `installation_id`, but its
documentation warns that this value can be spoofed. Loopworks also needs to
distinguish a genuine first installation from a replay and from a fresh return
for an installation already connected to the control plane.

An installation must exist independently of repository selection. Deriving it
from `repositories.installation_id` makes the first-run `no-installation` and
`no-repositories` stages impossible to distinguish.

## Decision

Persist GitHub App installations in `github_installations`, keyed globally by
GitHub's installation id. Store account identity, repository-selection mode,
the configured app id, and original operator attribution, but never an access
token, refresh token, private key, client secret, authorization code, or PKCE
verifier.

Protect each external redirect with a random ten-minute challenge. Persist only
its SHA-256 digest, actor, phase, optional candidate installation id, expiry,
and consumption timestamp in `github_installation_flows`. Consume a challenge
with one conditional database update so cross-actor, expired, concurrent, and
replayed callbacks fail closed.

Use two verification phases:

1. The Setup URL callback consumes the installation challenge and looks up the
   returned installation while authenticated as the configured GitHub App.
2. Loopworks starts the GitHub App web authorization flow with fresh state and
   PKCE. Its callback exchanges the code, confirms the immutable GitHub provider
   account id from `/user.id` matches the account bound to the active Loopworks
   session, and confirms that user can access the candidate installation before
   persistence. The transient user token is discarded.

The session projects only the GitHub account's immutable provider id from the
Auth.js account row, never its access token or raw provider profile. Missing,
malformed, or ambiguous account bindings fail closed for real GitHub sessions.
The explicit local fixture auth mode has no provider account row and retains its
existing callback bypass; production configuration forbids that mode. The
mutable GitHub login remains the human-readable installer and audit attribution,
but it is not an authorization proof: a renamed login with the same provider id
is accepted, while another provider id presenting the historical login is
rejected before installation discovery, access checks, App verification, or
persistence.

The Setup URL cannot be the only entry to phase 2. GitHub performs an
installation from `/apps/<slug>/installations/new` only when an eligible target
does not already have the App; when the only eligible account already has it,
GitHub short-circuits to that account's installation configure page and never
calls the Setup URL. Phase 1 then never runs, no challenge is consumed, and
Settings dead-ends on "Not connected" while GitHub reports the App as installed
— reproduced twice against production on 2026-08-05
([#151](https://github.com/ncolesummers/loopworks/issues/151)).

Therefore add a second, operator-initiated entry to the same phase 2:
`/api/github/install/reconcile` mints an authorization challenge carrying **no**
candidate installation and starts the web authorization flow with fresh state
and PKCE against the one registered callback URL. An authorization challenge
with no candidate installation is, by construction, a reconciliation: the
Setup-URL entry always binds one. That distinction needs no new phase value, no
schema change, and no second registered callback URL.

Reconciliation discovers candidates from the operator's own token rather than
from a query parameter, so the same two proofs still hold: the GitHub user must
match the active Loopworks session by immutable provider account id, and the
installation must be reachable by that user. Candidates are filtered to the
configured App ID, deduplicated,
ordered newest first — GitHub installation ids increase monotonically, so the
account the operator just configured must survive the bound rather than be the
first thing it discards — and bounded so one callback cannot fan out unbounded
App API calls. Each surviving candidate is then verified as the App before
persistence exactly as the bound path verifies its single candidate. An
unverifiable or suspended candidate is skipped rather than failing the others.
Zero candidates of the configured App write nothing and return
`no-installation-found`.

Reconciliation is scoped to a portal that has no installation at all, which is
the state #151 describes. Once an installation of the configured App is stored,
it writes nothing and returns `already-connected`, before spending any GitHub
call. This is a correctness requirement, not a policy preference: repository
selection resolves its installation as the lowest installation id with no actor
scoping (`resolveInstallation` in `src/lib/github/repository-selection.ts`), so a
second reconciliation row would silently repoint the portal — and every
subsequent repository selection — at an account the operator merely belongs to.
Connecting an additional account therefore requires an explicit selection
surface and actor-scoped resolution, not a side effect of this route.

Reconciliation failures resolve to a result, never a rejection. Any gateway or
store rejection inside it is mapped by the same handler that maps the bound
path's failures, so a rate limit or an unavailable database cannot surface as an
unhandled error to callers.

"Redirect on update" is not the fix: its redirect carries `setup_action=update`
and no `state`, so no challenge can be consumed and it would trade a silent dead
end for a noisy one. Accepting a callback that presents `installation_id`
without a challenge is likewise refused — that is precisely the protection this
ADR exists to provide.

A fresh verified duplicate is idempotent: return `already-connected`, preserve
the original installer and installation time, refresh mutable account and
repository-selection metadata, and write no duplicate row. Cancellation and
pending organization-owner approval write no installation.

Settings projects only installation rows matching the active configured App
ID. A result query parameter is display-only and cannot render a successful
connection without a matching persisted installation.

Expose only stable result vocabulary to Settings: `connected`,
`already-connected`, `cancelled`, `no-installation-found`, `pending-approval`,
and `error`. Logs and OTel attributes contain route, phase, actor, and outcome
only. State, codes, verifiers, cookies, tokens, request bodies, and raw GitHub
errors or user responses are excluded. Provider account ids are excluded from
telemetry even though they are not secrets, keeping identity data out of the
callback's bounded attributes. Structured logger sanitization recursively
redacts these identity fields and authentication material at any object depth.

Settings derives its query-parameter allowlist from the one declared vocabulary,
so an outcome cannot gain operator-facing copy yet be dropped before it reaches
the surface. The parameter is display-only in both directions: it can neither
claim a connection the rows do not show nor claim the absence of one they do.

Settings must never render a disconnected state without an affordance that can
resolve it, so the disconnected surface offers both entries. A failed portal read
is not a disconnected state: it reports connection as unknown and, per ADR 0019,
renders no connection call to action.

`no-installation-found` names both causes GitHub conflates. `GET
/user/installations` lists an installation only when the signed-in operator can
access it, so an empty result means the App is not installed on that account *or*
that this operator cannot see it. Copy that named only the first would send the
operator back to the install link that already dead-ends.

## Consequences

Installation authenticity depends on both the configured app and the current
operator, rather than trusting a query parameter. The GitHub App registration
must configure its Setup URL and OAuth callback URL to the same Loopworks route
and provide a client id and secret in addition to its app id and private key.

The fixed HttpOnly PKCE cookie intentionally supports one active authorization
flow per browser. Starting another flow can invalidate the earlier tab, but it
cannot authorize or connect the wrong installation.

GitHub does not guarantee that abandoning the initial installation screen
returns to the Setup URL. Loopworks can represent cancellation or denial only
when GitHub calls the callback; silent abandonment remains externally
unobservable.

## Validation

1. PGlite tests prove one-time actor-bound consumption, expiry, concurrent
   replay rejection, independent installation persistence, and duplicate
   idempotency.
   `tests/unit/github/installation-reconcile.integration.test.ts` adds the
   reconciliation entry over a real store: the challenge persists with a null
   candidate installation and an unstored state digest, one connection crosses
   `no-installation` to `no-repositories`, replay and cross-actor callbacks write
   nothing, and revisiting a stored installation preserves the original
   installer.
2. Flow and gateway tests cover wrong-app installations, immutable provider
   account mismatch, login rename without identity loss,
   inaccessible installations, PKCE exchange failures, cancellation, pending
   approval, and user-access pagination. Reconciliation adds coverage for
   foreign-app candidates, zero candidates, several candidates, skipped
   unverifiable candidates, the candidate bound, and forged, cross-actor, and
   replayed reconciliation callbacks. `listUserInstallations` is exercised
   through the default Octokit client over MSW, not only an injected fake
   (ADR 0022).
3. Auth account and session tests prove the provider id is projected without a
   token. Logger tests redact installation state, authorization codes, PKCE
   verifiers, provider ids, raw GitHub user responses, and the registry-declared
   client secret. Metric and span tests keep callback attributes bounded to
   phase and outcome.
4. Component and browser tests cover real connected and disconnected states,
   result notices, keyboard navigation, responsive layout, and axe in both
   themes.
5. The opt-in coverage lane from issue #118 measures the whole repository; the
   installation flow, gateway, store, and runtime have focused coverage.
6. `bun run validate` and `bun run build` are the aggregate gates.

## Follow-Ups

1. Issue #125 consumes connected installations for organization and repository
   selection.
2. Confirm the Production GitHub App Setup URL and callback URL after the first
   deployment before accepting this ADR.
3. [Issue #203](https://github.com/ncolesummers/loopworks/issues/203) bound
   callback authorization to the immutable GitHub provider account id.
   [Issue #140](https://github.com/ncolesummers/loopworks/issues/140) retains the
   separate follow-up for bounded retention of consumed and expired installation
   challenges.
4. [Issue #151](https://github.com/ncolesummers/loopworks/issues/151) added the
   reconciliation entry, the `no-installation-found` result, and the
   disconnected-surface affordances. Acceptance remains pending review and
   aggregate validation.
5. Connecting more than one installation needs an explicit selection surface and
   actor-scoped installation resolution before reconciliation may write into an
   already-connected portal. Until then reconciliation refuses that case. The
   underlying gap is that `resolveInstallation` picks the lowest installation id
   for every operator; it predates this ADR and is not introduced by #151.
6. Reconciliation reports a partially successful run as `connected` and skips
   candidates it cannot verify, including suspended installations, without naming
   which. A per-candidate outcome vocabulary would improve that; Settings does
   list exactly the installations that landed, so the operator can see the
   result.
