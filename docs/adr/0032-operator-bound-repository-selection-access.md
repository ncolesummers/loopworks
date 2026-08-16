# ADR 0032: Operator-Bound Repository Selection Access

Status: Proposed
Date: 2026-08-15

Driving issue: [#145](https://github.com/ncolesummers/loopworks/issues/145)

## Context

Repository selection resolves the configured GitHub App installation and then
uses App installation credentials to list or mutate its repository projection.
The portal allowlist authenticates an operator to Loopworks, but does not prove
that the same GitHub account may access that installation. Passing only a
mutable login into this flow would leave a confused-deputy boundary.

Auth.js already persists the GitHub provider account and access token on its
server-side account row. The session projects the Auth.js user id and immutable
GitHub provider account id, never the token. GitHub restricts
`GET /user/installations` to GitHub App user access tokens, so this evidence is
valid only when Auth.js sign-in and installation authorization use the same
GitHub App.

## Decision

Authorize every repository-selection read and apply after resolving the one
configured-App installation and before reading selected repositories, minting
or using installation credentials, listing App repositories, or mutating a
selection.

The authorization subject contains only the Auth.js user id and immutable
GitHub provider account id. Read access evidence only when exactly one GitHub
account row belongs to that user, its canonical provider account id matches the
session, and it holds a non-blank access token. The token remains server-side
and is passed only to `GET /user/installations`; it is never projected into a
session, route argument, response, UI property, log, metric, span, or cache.

Enforce `AUTH_GITHUB_ID === GITHUB_APP_CLIENT_ID` for this decision. Missing or
mismatched client ids are indeterminate, even if a prior authorization was
cached. Deployments must therefore configure Auth.js with the same GitHub App
client id used by installation authorization.

A complete, canonical GitHub response that omits the resolved installation is
a definite denial. Missing, blank, duplicate, malformed, or mismatched local
identity evidence; malformed GitHub entries; token expiry; 401, 403, 429, 5xx,
or network failure; and configuration mismatch are indeterminate. Both outcomes
fail closed. API reads and applies return bounded
`403 {"status":"access-denied"}` for definite denial and generic
`502 {"status":"error"}` for indeterminate evidence. The server page maps both
to its generic unavailable presentation.

Cache only successful decisions for 60 seconds, keyed by immutable provider
account id, App id, and installation id. A cache hit still requires a valid
same-App configuration and unique matching local account row. Denials and
indeterminate outcomes are retried immediately. Concurrent misses for one tuple
may share one in-flight check, but the promise is removed on every outcome and
only a successful result creates an expiry entry.

Automatic refresh-token rotation is not added here. An expired or revoked token
is indeterminate. On a subsequent successful GitHub sign-in, Loopworks replaces
the existing Auth.js account row's access token with the newly issued token;
Auth.js's adapter does not update an existing OAuth account by itself. Signing
out and back in is therefore the recovery path. GitHub-side access revocation
can remain effective for at most the 60-second positive-cache window, measured
with a monotonic process clock so wall-clock changes cannot extend it. That
bounded delay is the accepted trade-off for avoiding a provider call on every
repository-selection refresh.

Explicit non-production fixture rendering returns before session lookup,
runtime construction, authorization, or cache access. Fixtures never populate
the production authorization cache.

Emit one OTel counter, structured log, and active-span outcome per attempted
authorization. Each carries only `operation` (`read` or `apply`), the coarse
authorization outcome, and cache-hit state. Provider ids, logins, tokens,
installation or repository identity, raw installation lists, raw errors, cache
keys, and request bodies are excluded.

## Consequences

An allowlisted operator can no longer use Loopworks as an App-credentialed
deputy for an installation their GitHub account cannot access. Unauthorized
stale selections cannot be read or deselected. Reads and applies incur a local
account lookup and, on a cache miss, one paginated GitHub user-installation
read.

Production and Preview must each use internally consistent Auth.js and GitHub
App credentials. Existing deployments configured with a separate OAuth App fail
closed until corrected. Token expiry is visible as generic unavailability, not
misclassified denial, and successful re-authentication rotates the stored
access token.

The current lowest-installation resolution remains unchanged. Selecting among
multiple installations is [#146](https://github.com/ncolesummers/loopworks/issues/146).

## Validation

1. PGlite account-reader tests cover unique matching evidence and missing,
   ambiguous, malformed, blank-token, and provider-mismatched rows.
2. Authorization tests cover same-App configuration, immutable tuple isolation,
   exact monotonic 60-second expiry, positive-only storage, concurrent misses,
   provider recovery, and rejected-promise cleanup.
3. Flow, API, page, and integration tests prove denial and indeterminate
   evidence touch no selected rows, App repository reads, or mutations while an
   authorized subject preserves existing behavior.
4. Default Octokit/MSW tests cover pagination, valid absence, malformed entries,
   and 401, 403, 429, and 5xx failures without reaching the network.
5. Logger, metric, and span tests assert bounded fields and exclude token,
   provider, cache-key, installation, repository, raw-error, and body canaries.
6. Browser verification covers the existing main, unavailable, responsive,
   keyboard, and accessibility presentations. Authorization itself is proven at
   the offline GitHub boundary, not by fixture rendering.
7. `bun run validate` and `bun run build` are required before publication.

## Follow-Ups

- [#146](https://github.com/ncolesummers/loopworks/issues/146) defines explicit
  multi-installation selection and actor-scoped installation choice.
- If Auth.js gains reviewed automatic refresh-token rotation, update this ADR in
  place and retain the same fail-closed and no-projection boundaries.
