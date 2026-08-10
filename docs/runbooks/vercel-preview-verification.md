# Vercel Preview Verification

Target: **Vercel Preview deployments**. This runbook does not apply to local
development, and its Stage C step writes live secrets to a hosted environment.

Preview exists so the GitHub installation and repository-selection surfaces can
be exercised against real GitHub before a change reaches production. Reaching
them requires three separate things to line up: the configuration contract, a
stable origin, and the protection gate.

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
the alias mid-verification and silently invalidate the evidence.

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

`DATABASE_URL` and `DATABASE_URL_UNPOOLED` are omitted deliberately. The
Vercel-managed Neon integration owns them per environment; setting them by hand
would pin Preview to another branch's database.

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
3. **No production data.** Confirm the deployment's resolved `DATABASE_URL`
   points at a Neon preview branch, not the production branch. Preview and
   Production currently share project-level database variables; until
   [#70](https://github.com/ncolesummers/loopworks/issues/70) finishes the Neon
   wiring, verify this before trusting a pass.

## Evidence

Record variable **names**, screenshots, and redirect outcomes. Never copy
cookies, OAuth state, authorization codes, tokens, or environment values into
GitHub.
