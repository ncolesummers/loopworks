# Vercel Preview Verification

Target: **Vercel Preview deployments**. This runbook does not apply to local
development, and its Stage C step writes live secrets to a hosted environment.

Preview exists so the GitHub installation and repository-selection surfaces can
be exercised against real GitHub before a change reaches production. Reaching
them requires three separate things to line up: the configuration contract, a
stable origin, and the protection gate. Its database is one fixed, disposable
root in a Neon project separate from Production; it contains no copied
Production data.

## Why preview needs the full production contract

A Vercel Preview deployment runs with `NODE_ENV=production`, so
`resolveConfigRuntimeContext` classifies it as `production` and
`instrumentation.register()` enforces the entire production set before
middleware runs. A variable missing from Preview therefore returns 500 for every
route including `/` — the same failure production hit in
[the repository-selection runbook](github-repository-selection-verification.md),
one environment over. This is what issue
[#221](https://github.com/ncolesummers/loopworks/issues/221) reproduced:
`AUTH_GITHUB_ID (auth): value is required`.

Preview and Production share one variable contract, derived from the
configuration registry:

```bash
bun run vercel-env:check preview
```

It reports missing names only. Values are never read, so its output is safe to
paste into an issue.

## Stage A — the stable alias

[ADR 0021](../adr/0021-secure-github-app-installation-callback.md) allows the
GitHub App exactly one registered callback URL, and preview hostnames carry a
per-branch hash. Preview therefore verifies through one stable alias.

Add the alias host under Project → Domains once, then set the
`VERCEL_ACCESS_TOKEN` repository secret and three repository variables:
`VERCEL_PREVIEW_ALIAS`, `VERCEL_PROJECT_ID`, and `VERCEL_ORG_ID`. The last two
are needed because `.vercel/` is gitignored, so the linked-project file exists
locally but never in a CI checkout; both values are shown by
`vercel project inspect`. From then on, labelling a pull request `preview:alias`
runs
[`preview-alias.yml`](../../.github/workflows/preview-alias.yml): it waits for
that pull request's preview build to reach READY, repoints the alias, and
comments the URL. Re-pushing to a labelled pull request repoints it again.

The label is opt-in because one alias cannot serve two pull requests. Assigning
it automatically on every preview build would let a second pull request steal
the alias mid-verification and silently invalidate the evidence. **Every
database-changing pull request must carry `preview:alias` before alias-bound
hosted validation.** Treat it as an exclusive lease: the workflow fails closed
unless exactly one open pull request holds the label, and that pull request
keeps it until its browser and data evidence is captured. Removing the label
releases the lease; a second labelled pull request cannot repoint the alias
until it is the sole open holder and reruns the workflow. Vercel builds are
created before the workflow runs. Before a Preview build reaches `db:migrate`,
the migration runner checks the live PR files and labels, and refuses a
database-changing PR unless it is the sole holder; this check uses
`VERCEL_GIT_PULL_REQUEST_ID` and requires the live PR head to match
`VERCEL_GIT_COMMIT_SHA`. It uses the Preview-only least-privilege
`LOOPWORKS_PREVIEW_GITHUB_TOKEN`, rechecks the head after file classification,
and requires the final holder list to contain that same head and label. A branch
Preview without a PR ID is build-only and opens no Postgres connection; hosted
database validation begins once a database-changing PR owns `preview:alias`.
A non-database PR is likewise build-only after exact-head file classification,
so it cannot apply a pending shared migration. The database advisory
lock serializes admitted migrations. Once Vercel reports READY, the alias
operation checks the live lease, label, and exact selected PR head again
immediately before its mutation. It selects only a READY Preview deployment
whose Vercel metadata contains both the exact commit and this exact pull-request
number. A pre-PR build has no matching PR metadata and cannot become evidence;
a labelled PR may reuse its matching PR-associated build. This controls trusted
non-fork PR code, not arbitrary code already trusted with Preview credentials.
This relies on Vercel's current `meta.githubPrId` deployment metadata (verified
read-only on 2026-08-22); the alias intentionally fails closed if that provider
contract disappears.

The workflow runs on `pull_request`, which withholds secrets from fork
branches. Fork pull requests cannot be aliased; that is deliberate, because the
job holds a Vercel token.

## Stage B — the preview GitHub App

Preview uses **its own** GitHub App, never production's. A preview deployment
holding the production private key could act on production installations, which
is exactly the boundary preview exists to protect.

Create it under Settings → Developer settings → GitHub Apps, with the Stage A
origin:

| Field | Value |
| --- | --- |
| Setup URL | `https://<alias>/api/github/install/callback` |
| Callback URL | `https://<alias>/api/github/install/callback` |
| Callback URL | `https://<alias>/api/auth/callback/github` |
| Webhook URL | `https://<alias>/api/github/webhooks` |

One path serves both installation and authorization phases; the route
distinguishes them by whether GitHub sent a `code`. The second callback is the
Auth.js sign-in leg, which is why `AUTH_GITHUB_ID` and `GITHUB_APP_CLIENT_ID`
hold the same value. Both callbacks must be registered: `beginAuthorization`
pins `redirect_uri` explicitly, and GitHub rejects an unregistered one.

**Leave "Request user authorization (OAuth) during installation" unchecked.**
GitHub disables the Setup URL field while it is on, and Loopworks needs that
field: `start()` mints an *installation*-phase challenge, and only a Setup-URL
return — carrying `state` and `installation_id` but no `code` — resolves to the
installation phase. With OAuth-during-installation enabled GitHub sends a `code`
instead, the route reads the authorization phase, finds no matching challenge,
and dead-ends on `/settings?github=error`. Phase 2 is started by the
application afterwards, not by GitHub.

Grant
**Repository → Metadata: Read** at minimum: without it the repository list comes
back empty and is indistinguishable from the zero-access state, so a
verification would appear to pass while asserting nothing.

Install the preview App on a sandbox account only — never on an account holding
production data.

## Stage C — write the preview environment

**This step writes live secrets.** Keep the filled-in file out of version
control; `vercel-env.local` is gitignored.

```bash
cp scripts/vercel-env.example vercel-env.local   # LOOPWORKS_ENV_TARGET="preview"
bun run vercel-env:write preview --file vercel-env.local
```

The declared target must match the command argument. That check is what stops a
production file from being written into Preview. The script also validates every
value against the registry before anything leaves the machine, and refuses a
preview file that enables `LOOPWORKS_AUTH_BYPASS` or leaves the allowlist empty
— both would erase the auth boundary the verification is meant to prove.

`LOOPWORKS_PUBLIC_URL` must be the Stage A alias: the installation callback URL
is derived from it, and a mismatch produces a callback GitHub rejects.

Fill in `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`LOOPWORKS_EXPECTED_STORE_ID`, and `LOOPWORKS_PREVIEW_GITHUB_TOKEN` for the
fixed Preview root. They are required for Preview only: runtime uses the pooled
URL, migrations use the direct URL, the identity is distinct from Production,
and the token has only pull-request read access for authenticated lease checks.
The writer validates the URL pair and
refuses malformed or role-swapped values without exposing credentials. Before
an ordinary Preview migration, the runner independently queries the target
database's existing `store_identity` and requires it to match the expected
Preview value. A copied Production target therefore fails before the advisory
lock or migration; never copy any of these values from Production. Production
keeps integration-owned URLs and its target file rejects them.

For a fresh Preview root, do not send a normal build first. Under separately
authorized cutover authority, use the exact project-and-root-scoped external
schema procedure in the
[Neon deployment runbook](vercel-neon-deployment.md#authorized-preview-root-cutover),
then provision and install the newly read Preview identity before redeploying.
No application bootstrap mode exists, because a blank database cannot prove it
is Preview rather than Production.

`vercel-env:write` is intentionally initialization-only: it refuses before any
mutation if one of its target names already exists, rather than using Vercel's
unsafe remove-then-add replacement. Update an existing environment only through
an explicitly authorized operator procedure, then rerun the name-only check.

Environment changes do not apply to existing builds. Redeploy:

```bash
vercel redeploy <preview-deployment-id>
```

## Stage D — reach the preview

Vercel Authentication stays **on**. The authorized path is an account, not a
bypass secret: in a fresh headed `agent-browser` session with a persistent
profile, sign in at `vercel.com` once with the authorized account, then open the
alias. No protection-bypass secret exists to leak or rotate.

The Vercel SSO redirect is the protection layer, not an application fault. It is
independent of the 500 described above; both were present in #221 and only the
second was a bug.

## Stage E — verify

Walk steps 1–10 of
[the repository-selection table](github-repository-selection-verification.md),
which already encodes the install and repository-selection assertions.

Three checks are specific to preview:

1. **Auth boundary.** Confirm `LOOPWORKS_AUTH_BYPASS` is not enabled, then
   request `/settings` signed out and confirm the redirect.
2. **Error states.** Steps 1 and 10 cover "Not connected" and "No repositories
   reachable".
3. **Separate disposable data.** Confirm credential-free deployment evidence
   names the Preview project/root, verifies the Preview identity, and cannot
   name Production or copied Production data.
4. **Exclusive alias evidence.** For database-changing work, confirm the
   `preview:alias` workflow completed for the exact pull-request head, keep the
   label on that pull request while browser and data evidence is captured, and
   remove it only when that evidence is complete. Browser journeys remain
   manual, but the held lease prevents a competing pull request from repointing
   the alias during them.

## Evidence

Record variable **names**, screenshots, and redirect outcomes. Never copy
cookies, OAuth state, authorization codes, tokens, or environment values into
GitHub. See [ADR 0035](../adr/0035-cost-bounded-neon-preview-database-topology.md)
for the topology and separately authorized provider cutover.
