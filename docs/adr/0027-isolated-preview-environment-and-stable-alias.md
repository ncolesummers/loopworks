# ADR 0027: Isolated Preview Environment And Stable Preview Alias

Status: Proposed
Date: 2026-08-09
Issue: [#221](https://github.com/ncolesummers/loopworks/issues/221)

## Context

Preview deployments are where GitHub installation and repository-selection
surfaces get exercised against real GitHub before a change reaches production.
Three properties had never been settled for that environment, and all three
blocked the headed verification promised by
[#128](https://github.com/ncolesummers/loopworks/issues/128).

A Vercel Preview deployment runs with `NODE_ENV=production`. ADR 0020 resolves
that to the `production` configuration context and enforces the full production
set from `instrumentation.register()`, before middleware. Preview therefore
carries production's variable contract, but the provisioning tooling only ever
targeted Production, so Preview held none of the auth or GitHub App values and
every route returned 500 — the identical failure production hit earlier, one
environment over.

ADR 0021 registers exactly one GitHub App callback URL. Preview hostnames carry
a per-branch hash, so no preview deployment could satisfy a registered callback
and the installation flow was unreachable in preview by construction.

Vercel Deployment Protection independently redirects preview to Vercel SSO. That
gate was never wrong, but it was also never documented, so it read as part of
the failure.

## Decision

1. Treat Preview and Production as one registry-derived application contract.
   ADR 0035 adds a deliberate target-specific exception: Production keeps its
   integration-owned database URLs, while Preview must manually provide pooled
   and direct URLs plus its distinct expected store identity.
2. Validate that Preview pair locally before it reaches Vercel: it must be a
   pooled/direct Neon pair for the same fixed Preview database. Production files
   continue to reject database URLs so they cannot overwrite the integration.
3. Provision each environment from a target-declaring env file.
   `LOOPWORKS_ENV_TARGET` must match the write target, so production credentials
   cannot be written into Preview by reusing a file. Values are validated
   against the registry locally, before anything leaves the machine.
4. Verify configuration by name only. `vercel-env:check` reports missing names
   and never reads a value, so its output is safe to attach to an issue.
5. Give Preview its own GitHub App and OAuth credentials. A preview deployment
   must never hold the production App's private key, because that key can act on
   production installations.
6. Reach preview through one stable alias, assigned by CI. The `preview:alias`
   label points the alias at that pull request's preview deployment; the
   assignment refuses any deployment whose target is production. Aliasing is
   opt-in because one alias cannot serve two pull requests, and reassigning it
   under an in-flight verification would silently invalidate the evidence.
   Database-changing pull requests must use this label: its queued global
   concurrency group serializes the workflow's alias-bound reachability check
   against the shared Preview target. The Preview build independently checks its
   live GitHub PR files and labels with a Preview-only least-privilege token
   before a database-changing migration can reach Postgres, requires the exact
   Vercel build commit to match the live PR head throughout classification, and
   alias assignment rechecks the live sole-holder lease, label, and selected PR
   head after Vercel reports READY and immediately before mutation. It selects
   only a READY deployment whose metadata has the exact PR number and commit,
   so a pre-PR build that skipped migration cannot become alias evidence. The database
   advisory lock remains responsible for admitted migrations.
7. Keep Deployment Protection enabled and make the authorized path an account,
   not a secret. Verification signs in to Vercel with the authorized account in
   a persistent browser profile. No protection-bypass secret is created, so
   none can leak or require rotation.
8. Forbid `LOOPWORKS_AUTH_BYPASS` and an empty allowlist in a written preview
   environment. A preview that skips the application's own GitHub authorization
   proves nothing about the auth boundary it exists to exercise.

## Consequences

Preview becomes verifiable without weakening production: the credentials, the
GitHub App, and the installation targets are disjoint, so a compromised or
misconfigured preview cannot reach production installations or data.

Registry, provisioning, and both environments share one source, so the failure
mode that produced this ADR — an environment silently missing a required
variable — surfaces from a check command instead of a 500.

The costs are real. A second GitHub App must be created and maintained, and its
permissions can drift from production's. The alias queues only its own
reachability check; it cannot serialize Vercel builds or unauthenticated manual
browser journeys. Fork pull requests cannot be aliased at all, because the
workflow runs on `pull_request` and deliberately withholds the Vercel token
from fork-authored code.

Preview's database is a separately provisioned disposable root in another Neon
project (ADR 0035). Before an ordinary Preview migration, the runner reads the
target database's existing store identity and requires the distinct Preview
identity, rejecting a copied Production target before migration; that identity
also protects portal reads from a misrouted target. A fresh Preview root uses
the exact-target, separately authorized external cutover described by ADR 0035;
application code cannot bootstrap it safely.

## Validation

`bun run vercel-env:check preview` and `... production` report a complete
contract. Unit tests cover contract derivation, name-only parsing, the
target-mismatch refusal, the auth-boundary refusals, and the refusal to alias a
production deployment. The runbook
[Vercel preview verification](../runbooks/vercel-preview-verification.md)
carries the operator procedure.

## Follow-Ups

- Create the preview GitHub App and populate the Preview environment; only then
  can the headed verification in #221 complete.
- Complete ADR 0035's separately authorized provider cutover and attach its
  credential-free topology evidence to #285.
- `VERCEL_ACCESS_TOKEN` remains optional in the registry. It degrades the
  deployments surface when absent but is not part of the startup contract; CI
  alias assignment is its first required use.
