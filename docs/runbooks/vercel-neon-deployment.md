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
