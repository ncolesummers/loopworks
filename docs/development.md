# Development

This guide is the canonical local-development entry point. Configuration names
and defaults live in the generated [`.env.example`](../.env.example); update the
configuration registry rather than maintaining another variable list here.

## Fixture Mode

The quickest path needs no GitHub or database credentials:

```bash
bun install
LOOPWORKS_PORTAL_DATA_MODE=fixtures bun run dev:fixture
```

Open <http://127.0.0.1:3000>. Both fixture data and auth bypass are ignored in
production.

## Local Integrations

Copy `.env.example` to the untracked `.env.local`, replace only the values your
workflow needs, and keep Postgres on a loopback host. Then run migrations before
starting the ordinary server:

```bash
bun run db:migrate
bun run dev
```

`bun run dev` needs nothing further. A local **production** server does:
`next start` sets `NODE_ENV=production` with no `VERCEL_ENV`, so the portal
verifies the store's identity before reading it (#158) and otherwise renders
every surface as unavailable. To run one:

```bash
bun run db:provision --check     # prints the identity, or exits 1 if there is none
```

Set `LOOPWORKS_EXPECTED_STORE_ID` in `.env.local` to the value it reports, using
`bun run db:provision` first if the store has none. Copying the placeholder out
of `.env.example` does not work — it is treated as unconfigured on purpose, so a
pasted example cannot masquerade as a verified store.

`bun run scripts/seed-day-zero.ts reset` truncates every public table, which
takes the identity row with it. `bun run db:migrate` will not restore it —
migration `0003` is already recorded as applied — so re-run `bun run db:provision`
and update the variable after a full reset.

For hosted Preview and Production configuration, use the
[Vercel and Neon runbook](runbooks/vercel-neon-deployment.md).

## Webhook Fixtures

Inspect a signed issue webhook without sending it:

```bash
bun run github:webhook-fixture -- --kind agent-ready
bun run github:webhook-fixture -- --kind spike-agent-ready
```

Sending must use the immutable tuple for an active tracked repository and an
actor whose live repository permission is triage or higher. The local server
also needs GitHub App credentials so it can perform the installation-authenticated
permission read:

```bash
bun run github:webhook-fixture -- --kind agent-ready --send \
  --repository owner/repository --repository-id 123456 \
  --installation-id 789012 --sender-id 345678 --sender-login operator
```

The script refuses non-loopback targets and refuses `--send` when any tuple
field is implicit. Dry runs retain deterministic realistic sample values.

## Local Database Data

After migrations, seed the fixed demo rows with `bun run db:seed`. Use
`bun run db:seed:reset` to replace only those owned rows, or add `-- --dry-run`
to either command to inspect its plan. ADR 0007 requires both commands to reject
production runtimes, remote hosts, and non-Postgres URLs.

The browser and native concurrency lanes use a dedicated local database:

```bash
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:e2e:seeded
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:integration:postgres
```

The seeded lane proves live database behavior. The native lane uses independent
Postgres sessions for lock-scheduling evidence that PGlite cannot provide.
**Both the native lane and the seeded lane's day-zero stage truncate every table
in the `public` schema of `loopworks_e2e` with identity restart and cascading
cleanup.** Run the seeded lane again afterward if you need its demo rows.

`test:e2e:seeded` orchestrates two browser projects in sequence. The `day-zero`
project walks a brand-new operator from an empty database to a registered loop,
so it runs first, on the database migration leaves behind;
`scripts/seed-day-zero.ts` stages it (`reset`, `installation`, `repository`)
under the same guard, and its reset returns the database to empty before the
demo rows land for the `seeded-postgres` project. Stage the walk by hand while
debugging:

```bash
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run scripts/seed-day-zero.ts installation
```

### Recreating the test database

**Destructive: the following commands delete the entire local `loopworks_e2e`
database.** Use them only for the named loopback test database, such as after a
pre-production migration baseline changes:

```bash
dropdb --host 127.0.0.1 --username loopworks loopworks_e2e
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
```

Recreate any remote non-production database through its provider. Never point
these commands at a hosted database.

## Git Hooks

Install and run the repository hooks with:

```bash
bun run precommit:install
bun run precommit:run
```

The hook invokes the same `bun run precommit` aggregate gate contributors run
before review.
