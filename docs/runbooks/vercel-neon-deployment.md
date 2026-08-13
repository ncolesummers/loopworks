# Vercel And Neon Deployment

Target: **Vercel Preview and Production deployments backed by Vercel-managed
Neon Postgres**. This runbook does not apply to local development.

## Connection Contract

Application queries use pooled `DATABASE_URL`; deployment migrations use direct
`DATABASE_URL_UNPOOLED`. Both URLs must identify the same Neon branch and
database. Hosted builds fail before connecting when either URL is missing,
malformed, mismatched, or assigned the wrong pooled/direct role.

Vercel and Neon own hosted branch creation and connection injection. Each
Preview requires an isolated provider-managed branch that is removed with the
Preview lifecycle. The application does not create or select hosted branches.

## Build And Migration

Vercel runs `bun run vercel-build`, which applies migrations before the Next.js
build. Ordinary `bun run build` remains migration-free. The migration command
holds a Postgres advisory lock so overlapping builds for one database serialize.

After changing project variables, refresh the untracked local file with:

```bash
vercel env pull .env.local --yes
```

**Secret handling:** this overwrites `.env.local`. Preserve local-only values,
review the result, and never commit it. Development should remain connected to
local Postgres rather than a Production or Preview database.

## Store Identity

Each database is issued a `store_identity` row when migration `0003` creates it.
Production reads compare that value against `LOOPWORKS_EXPECTED_STORE_ID` before
reading anything else, so a deployment pointed at the wrong Neon branch, or at
one that was emptied, fails closed instead of rendering as a new install
(#158, [ADR 0019](../adr/0019-first-run-state-model-and-onboarding-ia.md)).

This applies to Production only. Preview deployments build with
`NODE_ENV=production` but are handed provider-owned databases that turn over
with the Preview lifecycle, so no project-level value could name them; the check
opts Preview out and Stage E of the preview runbook keeps its manual
"No production data" verification. Do not set this variable on the Preview
target.

Set it on Production. Read the value the store reports:

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
already has one it is a no-op, and it will not mint a replacement.

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
- **Recreating a branch from scratch.** A database built fresh runs migration
  `0003` again and gets a *new* identity, so the variable must be updated to
  match. That is the intended friction: the same signal that would otherwise be
  a silent wrong-database read.
- **Branching or restoring, by contrast, copies the identity row.** A branch of
  the production database reports production's identity and verifies clean, so
  this check will not tell you that you are pointed at a stale copy of your own
  data. Confirm the branch by name before trusting a deployment; the check
  proves *which database was named*, not that it is current.

## Safety Boundaries

- Never run `bun run db:seed` or `bun run db:seed:reset` against hosted Neon.
- Never copy a Production database URL into a local destructive command.
- If a non-production database predates a squashed migration baseline, recreate
  it through Neon or Vercel rather than applying the replacement journal in
  place.
- Keep runtime queries pooled and migrations direct; do not swap the URLs to
  work around a failed build.

The durable architecture and trade-offs are recorded in
[ADR 0018](../adr/0018-vercel-managed-neon-deployment-migrations.md).
