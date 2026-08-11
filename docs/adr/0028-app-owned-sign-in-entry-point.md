# ADR 0028: App-Owned Sign-In Entry Point And Safe Failure Surface

Status: Proposed
Date: 2026-08-10
Issue: [#214](https://github.com/ncolesummers/loopworks/issues/214)

## Context

Loopworks configured no Auth.js `pages` option, so an unauthenticated request to
a protected route was redirected to the framework's built-in page at
`/api/auth/signin`. That page renders a single provider button, hotlinks its
GitHub mark from `authjs.dev` with no `alt` attribute, and says nothing about
what Loopworks is, why GitHub is required, what happens after sign-in, or that
access is allowlisted. It was the first product experience, and it was an
unattributed OAuth setup screen.

The failure path was worse than the happy path. A denied allowlist decision
rendered Auth.js's own error page with the raw error code on screen.

## Decision

Serve sign-in from an app-owned route at `/sign-in`, and route every Auth.js
sign-in failure to that same route with a mapped, non-disclosing notice.

### Both `pages` entries point at the route

`src/lib/auth/pages.ts` exports one `authPages` object and `src/auth.ts` spreads
it. `error` deliberately aliases `signIn`, and that aliasing is load-bearing
rather than cosmetic.

Auth.js selects an error's destination from the error's `kind`. `AccessDenied` —
thrown when `callbacks.signIn` returns `false`, which is exactly how the
username and organization allowlists reject an identity — extends `AuthError`
rather than `SignInError`, so it inherits `kind: "error"` and routes through
`pages.error`. Pointing `error` anywhere else sends the single most important
state this surface renders back to the framework's page, silently, with every
other test still green. `tests/unit/auth/pages.test.ts` asserts the equality and
carries that reason in its failure message.

`ErrorPageLoop` is not a risk here. It is raised only when the Auth.js config
itself fails to assert, and its trigger is a `callbackUrl` that starts with the
error page — which the redirect sanitizer below can never produce.

### Failure codes are a closed vocabulary

`src/lib/auth/sign-in-errors.ts` maps only the Auth.js error types this
configuration can produce — `AccessDenied`, `OAuthCallbackError`,
`OAuthAccountNotLinked`, `MissingCSRF`, and the `Configuration` catch-all — to
operator-facing title, detail, next step, and a `Status` from the shared
vocabulary. Everything else collapses to one generic notice.

A closed map is required rather than preferred. The proxy clones the whole
request URL when it redirects, so any query parameter on the original request
survives onto the sign-in URL, and `/api/auth/error` forwards its `error`
parameter verbatim. The value is fully attacker-controlled, and the raw
parameter is never rendered as visible operator copy.

The copy states outcomes and human next steps, never mechanism. Naming the
allowlist, an organization, a scope, or the Auth.js error type would tell an
unauthorized visitor how access is decided.
`tests/unit/auth/sign-in-errors.test.ts` enforces that by forbidden-substring
assertion so a later copy edit cannot quietly cross the line, and the same file
forbids the substring `http`, because no public docs or landing route exists to
link to yet.

### The callback target is reduced to a path

`src/lib/auth/sign-in-redirect.ts` discards the origin of an inbound
`callbackUrl` outright and forwards only `pathname + search`. Auth.js applies a
similar rule downstream, but it compares against an origin derived from the
`Host` header under `trustHost: true`, and the page renders this value into a
hidden field before Auth.js ever sees it. The sanitizer additionally refuses to
land an operator back on `/sign-in` or on an Auth.js internal route. It runs
twice: once in the page, and once in the server action, because the hidden field
is client-controlled regardless of what the page put there.

### Sign-in starts from a server action

`src/lib/auth/sign-in-action.ts` is the repository's first `"use server"`
module. It calls `signIn("github", { redirect: false })` and performs its own
`redirect`. Auth.js's redirecting path rethrows an `AuthError`, so a
misconfigured server would otherwise escape as an unhandled 500 rather than the
readable state this decision exists to provide — while catching around a
redirecting call would instead swallow `NEXT_REDIRECT`. Requesting the URL and
redirecting separately keeps `redirect()` outside the `try` and makes both
failure modes unreachable. The returned URL is narrowed to GitHub's exact
`https://github.com/login/oauth/authorize` endpoint before it is followed.

Every export of a `"use server"` module is a public endpoint. This one only
starts an authorization handshake, and it sanitizes its one input. A failed
GitHub organization lookup returns the generic configuration notice unless a
directly approved user or local bypass already authorizes the account; it is
never treated as proof that the account is not approved.

### The GitHub mark is vendored, not hotlinked

`src/components/auth/github-mark.tsx` inlines the Invertocat path from GitHub's
own brand toolkit with `fill="currentColor"`, so it resolves near-black in light
mode and near-white in dark. That satisfies ADR 0009, which permits no colour
outside the neutral ramp, the single blue accent, and the semantic status
families, and it matches GitHub's own black-or-white guidance. The mark is a
trademark used nominatively to label a GitHub sign-in action, so it ships with
provenance recorded in the source rather than with a licence file of the kind
`src/app/fonts/` carries for the OFL typefaces.

### What this decision does not cover

Public information architecture. The route is a flat `src/app/sign-in/page.tsx`
with no route group and no shared unauthenticated layout, precisely so it makes
no such commitment.
[#104](https://github.com/ncolesummers/loopworks/issues/104) owns the
unauthenticated route group and its IA ADR, and can later move this file into
whatever group it defines as a pure file move with no URL change.

## Consequences

An operator reaching Loopworks for the first time reads what the product is, why
GitHub holds the identity, that access is approved rather than self-served, and
the three activation steps ADR 0019 orders — before authenticating.

An unauthorized visitor learns that they are not approved and who to ask, and
learns nothing about how the decision was made.

`pages.error` and `pages.signIn` are now coupled in a way that is invisible at
the call site. The single exporting module and its test are the mitigation; a
future change that splits them must justify itself against the `AccessDenied`
routing above.

The repository now has a `"use server"` precedent. Later actions inherit the
obligation that every export is a public endpoint.

## Validation

`tests/e2e/auth-guard.spec.ts` proves an unauthenticated protected-route request
still redirects, that the protected surface never renders, and that the
destination now carries the product orientation. Its bypass-disabling header is
what makes that a guard test rather than a page test: the Playwright lane runs
with `LOOPWORKS_AUTH_BYPASS=true`.

`tests/e2e/sign-in.spec.ts` covers the denial and failure states, keyboard
operation and focus ring, mobile and desktop widths, surface-height stability
between clean and failed states, the absence of any outbound link, and axe with
no violations in light and dark. It also drives the whole server-action
mechanism offline by intercepting `https://github.com/**`, asserting the handoff
reaches `github.com/login/oauth/authorize` with unchanged scopes and that an
off-origin `callbackUrl` never survives.

`tests/unit/auth/` covers the page coupling, the redirect sanitizer, the error
vocabulary, the view's states, the server-action input boundary, and the
provider handoff guard.
`tests/unit/ci/playwright-spec-coverage.test.ts` fails if any end-to-end spec is
matched by no Playwright project, which is how a new spec would otherwise be
silently skipped.

The four pre-existing auth policy suites — `allowlist`, `session-policy`,
`identity`, and `github` — are unmodified and still pass, which is the evidence
that this change is presentational and widened no access.

`bun run validate` and `bun run build` are the aggregate gate.

## Follow-Ups

- [#104](https://github.com/ncolesummers/loopworks/issues/104) may move
  `src/app/sign-in/` into the unauthenticated route group it defines, and owns
  the public IA decision this ADR deliberately avoids.
- Link the sign-in surface to the getting-started guide and landing page once
  [#107](https://github.com/ncolesummers/loopworks/issues/107) and
  [#108](https://github.com/ncolesummers/loopworks/issues/108) ship. Until then
  the no-outbound-link rule is asserted by test.
- Move this ADR from Proposed to Accepted after review.
