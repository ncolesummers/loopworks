# Vercel And Neon Deployment

Target: **Vercel Preview and Production deployments backed by Neon Postgres**.
This runbook does not apply to local development, which remains local Postgres.

## Connection Contract

Application queries use pooled `DATABASE_URL`; deployment migrations use direct
`DATABASE_URL_UNPOOLED`. Both URLs must identify the same Neon database. Hosted
builds fail before connecting when either URL is missing, malformed, mismatched,
or assigned the wrong pooled/direct role.

Production keeps the Vercel-managed Neon integration and its integration-owned
URLs. Preview instead uses one fixed, disposable **root** database in a
separate Neon project, never a Production child branch and never copied from
Production. Preview manually owns its pooled URL, direct URL, and distinct
`LOOPWORKS_EXPECTED_STORE_ID` (three Preview database-target values), plus the
Preview-only GitHub lease token described below. The
target-declaring Preview environment writer validates malformed, role-swapped,
or mismatched URL values without printing credentials. Before an ordinary
Preview migration, the runner independently reads the target database's
`store_identity` and requires an exact match with the Preview expected value;
it fails before the advisory lock or migration if a copied Production target,
empty store, or any other identity mismatch answers. Production files reject
the URLs so they cannot overwrite the integration.

## Build And Migration

Vercel runs `bun run vercel-build`, which applies migrations before the Next.js
build. In Preview, the migration runner first reads the live GitHub pull request's changed files
and labels. A database-changing pull request must be the sole open
`preview:alias` holder or the build fails before `db:migrate` opens Postgres;
this requires Vercel's documented `VERCEL_GIT_PULL_REQUEST_ID`, repository
owner, repository slug, and `VERCEL_GIT_COMMIT_SHA` system variables; the live
PR head is rechecked before and after file classification, then again in the
final holder list. Set Preview-only `LOOPWORKS_PREVIEW_GITHUB_TOKEN` to a
least-privilege token that can read pull requests; it is sent as Bearer auth and
is never logged. The runner owns this gate, so a package-command change cannot
skip it accidentally. A PR with no database-sensitive path is build-only after
that exact-head classification, so an unrelated README build cannot apply a
pending shared-schema journal. A Preview branch with no pull-request ID is also build-only:
it exits migration before opening Postgres and continues against the fixed
schema; hosted database validation begins once a PR owns `preview:alias` and
the selected Vercel deployment has matching PR metadata. This applies to
trusted, non-fork PR code; code already trusted with Preview
credentials remains outside the gate's threat model. Ordinary `bun run build`
remains migration-free. The migration command holds a Postgres advisory lock so
overlapping admitted builds for one database serialize.

After changing project variables, refresh the untracked local file with:

```bash
vercel env pull .env.local --yes
```

**Secret handling:** this overwrites `.env.local`. Preserve local-only values,
review the result, and never commit it. Development should remain connected to
local Postgres rather than a Production or Preview database.

## Store Identity

Each database is issued a `store_identity` row when migration `0003` creates it.
Production and the fixed Preview target compare that value against their own
`LOOPWORKS_EXPECTED_STORE_ID` before reading anything else, so a deployment
pointed at the wrong, empty, or unprovisioned store fails closed instead of
rendering as a new install (#158, [ADR 0019](../adr/0019-first-run-state-model-and-onboarding-ia.md)).

Set the value separately in each hosted target. Read the value the intended
store reports:

```bash
bun run db:provision --check
```

That prints the identity without changing it, and exits non-zero when the store
has none. It also prints the host and database name it connected to — check that
line first. Bun auto-loads `.env.local`, so run it with the intended
`DATABASE_URL` explicitly in the environment; reading your local store's identity
and setting it as production's expected value produces a permanent mismatch that
the logs report as "another database answered".

Only a store with no identity needs `bun run db:provision`; on a store that
already has one it is a no-op, and it will not mint a replacement. Never copy a
Production identity into Preview or vice versa.

### Authorized Preview-root cutover

An ordinary Preview build deliberately cannot create a fresh root: it requires
the database-sourced identity check above. During a separately authorized
cutover only, apply the exact schema to the separately created Neon Preview
project/root through an operator procedure scoped and authenticated to that
exact target. This is not an application command or a Vercel build step: a
blank database provides no independent signal that distinguishes Preview from
Production. After that external schema application, run `bun run db:provision --check`
against the exact Preview root, install the returned distinct identity
alongside its two URLs and Preview-only lease token in Vercel Preview, and then
redeploy normally. Record
credential-free proof of the exact separate project/root. Do not perform any
of these provider actions without cutover authority.

Two consequences to plan for:

- **First deploy of this change, which has an unavoidable window.**
  `vercel-build` runs `db:migrate` and then the Next.js build, so the identity is
  minted *inside the deploy that needs it* — before that deploy the table does
  not exist and there is no value to read. The portal therefore renders
  "Unavailable" between that deploy landing and the variable being set. It is a
  portal-read outage, not a boot failure: the variable is deliberately not
  declared production-required, so `instrumentation.register()` still starts and
  sign-in and webhooks keep working. Plan the sequence: deploy, run
  `bun run db:provision --check` against production, set the variable, redeploy.
  `bun run config:check` will not remind you — this step is the reminder.
- **Recreating a disposable database from scratch.** Use the authorized
  Preview-root cutover procedure above. The initial external schema application
  creates a *new*
  identity, so the Preview variable must be updated to match before ordinary
  Preview deployments can migrate. That is intended friction: the same signal
  that would otherwise be a silent wrong-database migration.
- **A branch or restore copies the identity row.** The check proves which
  database was named, not freshness. The Preview root must therefore be a
  separately created database, never a Production child branch.

## Safety Boundaries

- Never run `bun run db:seed` or `bun run db:seed:reset` against hosted Neon.
- Never copy a Production database URL into a local destructive command.
- Never copy a Production URL or identity into Preview.
- If a non-production database predates a squashed migration baseline, recreate
  it through Neon or Vercel rather than applying the replacement journal in
  place.
- Keep runtime queries pooled and migrations direct; do not swap the URLs to
  work around a failed build.
- Do not create, branch, reset, delete, or reconfigure provider resources
  without separate operator authority.

The durable architecture and trade-offs are recorded in
[ADR 0035](../adr/0035-cost-bounded-neon-preview-database-topology.md).
