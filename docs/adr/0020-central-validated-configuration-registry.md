# ADR 0020: Central Validated Configuration Registry

Status: Accepted
Date: 2026-08-02
Accepted: 2026-08-13 after issue [#109](https://github.com/ncolesummers/loopworks/issues/109)
review, direct ADR backlink, and [PR #138](https://github.com/ncolesummers/loopworks/pull/138)
merge
Updated by: [#178](https://github.com/ncolesummers/loopworks/issues/178)

## Context

Loopworks configuration grew across application, agent, script, and test
boundaries without one inventory for validation, defaults, runtime
requiredness, or secret classification. The existing injected-environment
convention keeps readers testable and prevents build-time imports from requiring
runtime secrets, so centralization must preserve it rather than introduce an
eager module singleton.

Issue [#109](https://github.com/ncolesummers/loopworks/issues/109) requires the
registry before onboarding and the published environment reference can safely
depend on configuration metadata.

## Decision

1. Declare environment variables in an immutable Zod-backed registry with a
   name, group, description, safe example, contextual default, secret flag,
   read-only flag, and required runtime contexts.
2. Keep domain readers injectable with
   `env: Partial<NodeJS.ProcessEnv> = process.env`. Registry reads are evaluated
   per call; there is no eagerly parsed singleton.
3. Resolve configuration context as build, test, production, or development.
   The Next.js production-build phase takes precedence over `NODE_ENV`, and
   existing production detection continues to recognize both Node and Vercel
   production observations.
4. Require the production control-plane set at Node server startup: Auth.js and
   GitHub OAuth credentials, the pooled database URL, GitHub App and webhook
   credentials, and the agent receipt-signing secret. Vercel deployment
   visibility and OTel export remain optional.
5. Run aggregate production validation from `instrumentation.register()` before
   database and OTel initialization. Next.js does not register instrumentation
   during a production build, and the build context never enforces production
   startup requirements.
6. Preserve byte-sensitive secret values. Defaults apply only when a variable
   is absent, and safety-sensitive domain readers may intentionally bypass a
   registry default while still resolving a declared name.
7. Derive environment-variable redaction paths from registry secret metadata
   and retain the broader hand-maintained paths for headers, OAuth fields, and
   conventional token names required by ADR 0003.
8. Generate `.env.example` from user-configurable registry entries. Platform
   observations are declared read-only and omitted from generated operator
   configuration.
9. Reject new direct `process.env.X` and bracket value reads under production
   source roots. Bare `process.env` remains allowed for injected defaults and
   whole-environment handoffs; tests and runner configuration remain outside
   this guard.
10. Classify validation-subprocess exposure in the registry as an explicit,
    default-deny capability. The derived child environment copies only present
    entries that opt in and are non-secret. Issue
    [#178](https://github.com/ncolesummers/loopworks/issues/178) initially
    exposes `PATH`, `HOME`, `CI`, and the local strict-scanner flag. `NODE_ENV`
    remains excluded so a production host cannot force nested test and
    development servers into production mode after their secrets are removed.
    Adding another registry entry does not expose it automatically.

## Consequences

Configuration metadata, generated examples, startup validation, and secret
redaction share one source. Missing production configuration fails before the
server initializes and diagnostics name variables and groups without values.
Tests retain isolated environment injection, and builds do not require runtime
secrets.

Adding or changing configuration now requires updating the registry and
regenerating `.env.example`. Conditional safety rules such as hosted Neon
migration topology remain in their domain readers because a flat variable
schema cannot express those cross-variable invariants without weakening their
specific diagnostics.

The registry also owns the validation-child environment boundary. This avoids
duplicated allow-lists while retaining a second `secret === false` check if an
entry is accidentally marked for subprocess exposure. Non-secret values that
change authority or runtime behavior remain excluded unless separately
reviewed and opted in.

## Validation

1. Unit tests compare `.env.example` assignments with registry declarations,
   exercise context/default/schema policy, and verify startup failures.
2. Generator tests prove exact, idempotent output and stale-file detection.
3. The environment-access check parses production TypeScript/JavaScript source
   and reports prohibited reads with file and line evidence.
4. Logger tests prove every secret declaration contributes redaction paths.
5. `bun run validate` includes drift and access checks; `bun run build` proves
   startup validation does not execute at import or build time.
6. Validation-subprocess tests derive the exposed set from registry metadata,
   reject every secret entry, and exercise the real default executor.

## Follow-Ups

1. Issue #106 can publish the operator-facing environment reference from the
   registry metadata.
2. Issue #16 should use the registry secret inventory during the MVP security
   review.
