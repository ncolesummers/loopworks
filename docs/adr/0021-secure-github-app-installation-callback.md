# ADR 0021: Secure GitHub App Installation Callback

Status: Proposed
Date: 2026-08-02
Issue: [#124](https://github.com/ncolesummers/loopworks/issues/124)

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
   PKCE. Its callback exchanges the code, confirms the GitHub user matches the
   active Loopworks session, and confirms that user can access the candidate
   installation before persistence. The transient user token is discarded.

A fresh verified duplicate is idempotent: return `already-connected`, preserve
the original installer and installation time, refresh mutable account and
repository-selection metadata, and write no duplicate row. Cancellation and
pending organization-owner approval write no installation.

Settings projects only installation rows matching the active configured App
ID. A result query parameter is display-only and cannot render a successful
connection without a matching persisted installation.

Expose only stable result vocabulary to Settings: `connected`,
`already-connected`, `cancelled`, `pending-approval`, and `error`. Logs and OTel
attributes contain route, phase, actor, and outcome only. State, codes,
verifiers, cookies, tokens, request bodies, and raw GitHub errors are excluded.

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
2. Flow and gateway tests cover wrong-app installations, login mismatch,
   inaccessible installations, PKCE exchange failures, cancellation, pending
   approval, and user-access pagination.
3. Logger tests redact installation state, authorization codes, PKCE verifiers,
   and the registry-declared client secret.
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
3. [Issue #140](https://github.com/ncolesummers/loopworks/issues/140) binds
   authorization to the immutable GitHub provider account id and adds bounded
   retention for consumed and expired installation challenges.
