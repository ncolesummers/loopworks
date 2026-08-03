# Loopworks

Loopworks is an agentic software factory portal for planning, executing, validating, and improving software delivery loops. GitHub Issues are the source of truth for roadmap, planning, milestones, decisions, and execution state. Vercel is the application visibility surface for previews, deployments, and build status.

## Stack

- Next.js App Router, TypeScript, Bun
- ShadCN/UI and Tailwind CSS
- Auth.js GitHub SSO
- Postgres and Drizzle
- Biome, Vitest, Playwright, Storybook
- Markdownlint for Markdown documentation
- Pino structured logging
- Eve, Vercel Workflows, Vercel Sandbox, Vercel AI Gateway integration points

## Local Development

```bash
bun install
bun run dev
```

For local UI work without GitHub OAuth credentials:

```bash
bun run dev:fixture
```

To inspect a signed GitHub issue webhook fixture without sending it:

```bash
bun run github:webhook-fixture -- --kind agent-ready
bun run github:webhook-fixture -- --kind spike-agent-ready
```

The fixture defaults to `http://127.0.0.1:3000/api/github/webhooks`, uses
`GITHUB_WEBHOOK_SECRET`, and only posts to the local webhook route when
`--send` is provided. Sending is restricted to loopback URLs.

## Environment

Copy `.env.example` to `.env.local` for local development. The fixture server only needs the defaults from `.env.example`; real GitHub SSO, webhooks, database persistence, and Vercel deployment visibility use these variables:

- `AUTH_SECRET`
- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `LOOPWORKS_AUTH_BYPASS`
- `LOOPWORKS_ALLOWED_GITHUB_USERS`
- `LOOPWORKS_ALLOWED_GITHUB_ORGS`
- `LOOPWORKS_PUBLIC_URL`
- `LOOPWORKS_AGENT_READY_LOOP_ENABLED`
- `LOOPWORKS_DEVELOPMENT_LOOP_ENABLED`
- `LOOPWORKS_RESEARCH_LOOP_ENABLED`
- `LOOPWORKS_PORTAL_DATA_MODE`
- `LOOPWORKS_EVE_TEST_RECEIPT_SECRET`
- `LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE`
- `LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE`
- `LOG_LEVEL`
- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `OTEL_EXPORTER_OTLP_PROTOCOL`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_TRACES_HEADERS`
- `OTEL_EXPORTER_OTLP_METRICS_HEADERS`
- `OTEL_SERVICE_NAME`
- `OTEL_RESOURCE_ATTRIBUTES`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `VERCEL_ACCESS_TOKEN`
- `VERCEL_TEAM_ID`
- `VERCEL_TEAM_SLUG`

### Hosted Neon deployment

The Vercel-managed Neon resource owns hosted Postgres for Production and
Preview only. Runtime queries use the pooled `DATABASE_URL`; Drizzle migrations
use the direct `DATABASE_URL_UNPOOLED`. `src/db/client.ts` keeps prepared
statements disabled for compatibility with the pooled runtime connection.

Vercel runs `bun run vercel-build`, which applies migrations before the Next.js
build. The ordinary `bun run build` command remains migration-free for local
development. Hosted builds fail before connecting if
either database URL is missing, if either URL is malformed, if their Neon
branch or database differs, or if their pooled/direct roles are reversed.
`bun run db:migrate` holds a Postgres advisory lock while Drizzle applies
pending migrations, serializing overlapping builds that target the same
database.

The required Neon deployment actions create an isolated branch for each
Preview before the build and clean it up with the Preview lifecycle. Neon and
Vercel own branch creation, connection injection, and cleanup; the application
does not create or select hosted branches itself.

After provisioning or changing project environment variables, refresh the
untracked local file with:

```bash
vercel env pull .env.local --yes
```

The command overwrites `.env.local`, so preserve any local-only values before
running it and review the result afterward. Development is intentionally not
connected to the hosted Neon resource, so a Development pull does not select a
Production or Preview database. Continue to use local Postgres for development.
Never run `bun run db:seed` or `bun run db:seed:reset` against a hosted Neon
database.

OpenTelemetry is registered through `@vercel/otel`. Local development is safe
by default: leave the OTLP exporter variables blank unless you intentionally want
to ship telemetry. For the ADR 0012 Axiom preview proof, use OTLP/HTTP protobuf,
send traces to an Axiom Events dataset with
`OTEL_EXPORTER_OTLP_TRACES_HEADERS`, and send metrics to a dedicated Axiom
Metrics dataset with `OTEL_EXPORTER_OTLP_METRICS_HEADERS`. Pino stdout logs stay
attached to Vercel runtime logs with the active `traceId`; direct Pino-to-Axiom
log shipping is tracked separately by issue #65.

## Validation

```bash
bun run check
bun run agent-docs:check
bun run markdownlint
bun run typecheck
bun run test
bun run storybook:build
bun run test:e2e
```

`bun run test:e2e` owns a fresh development server with explicit non-production
fixture mode. It deterministically verifies the `Fixture fallback` path and
does not attach to an existing server. `LOOPWORKS_PORTAL_DATA_MODE=fixtures`
is ignored in production, where database failures continue to fail closed.

The seeded Postgres browser lane is separate. It requires a local
`loopworks_e2e` database owned by the `loopworks` role:

```bash
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:e2e:seeded
```

### Pre-production migration resets

Loopworks may squash its migration history before the first production
release. A database created from an older journal cannot apply a replacement
baseline in place; recreate it before running migrations.
[Issue #113](https://github.com/ncolesummers/loopworks/issues/113) replaced the
original `0000`-`0007` journal, so existing local and preview databases must be
reset. To recreate the explicitly local test database:

```bash
dropdb --host 127.0.0.1 --username loopworks loopworks_e2e
createdb --host 127.0.0.1 --username loopworks loopworks_e2e
```

Recreate any other non-production database through its provider rather than
pointing these local commands at a remote host.

The seeded command refuses production runtimes, non-Postgres URLs,
non-loopback hosts, and database names other than `loopworks_e2e` before it
runs migrations. It then runs migrations, resets only the fixed-id demo rows,
and requires `Live database` browser evidence. Migration or seed failures name
the failed stage; confirm Postgres is running and that the local role and
database exist.

The native Postgres admission lane uses the same database. It proves that
competing dispatch transactions on two independent sessions serialize on the
durable group guard, which the embedded PGlite suite cannot demonstrate:

```bash
DATABASE_URL="postgres://loopworks:loopworks@127.0.0.1:5432/loopworks_e2e" \
  bun run test:integration:postgres
```

It applies any pending migrations itself and enforces the same local-database
guard. Without a safe `DATABASE_URL` it fails with a non-zero exit rather than
skipping or falling back to PGlite, so a missing database can never be mistaken
for passing concurrency evidence. Each test truncates every table in the
`public` schema of `loopworks_e2e`, so run the seeded lane afterwards if you
need the demo rows back.

The aggregate command is:

```bash
bun run validate
```

## Git Hooks

Loopworks uses `pre-k` through `uvx prek`.

```bash
bun run precommit:install
bun run precommit:run
```

The pre-commit hook runs `bun run precommit`, which mirrors CI validation: Biome format check, Biome lint, agent docs sync, Markdownlint, TypeScript, Vitest, Storybook build, and Playwright.

## Planning

- Agent workflow: `AGENTS.md`
- Claude Code shim: `CLAUDE.md` imports `AGENTS.md`; run `bun run agent-docs:sync` after changing agent guides
- Contributing guide: `CONTRIBUTING.MD`
- Product requirements: `docs/prd.md`
- Architecture: `docs/architecture.md`
- ADR index: `docs/adr/README.md`
- Loop manifest: `docs/loop-manifest.md`
- Design-system planning: `docs/design-system-planning.md`
- Observability: `docs/observability.md`
- Personas and test scenarios: `docs/personas-and-test-scenarios.md`
- MVP security review: `docs/security-review.md`

## Database Seed Data

After the database bootstrap (`bun run db:migrate`), seed a demo dataset
covering repos, loops, runs, run steps, artifacts, approvals, and Vercel
deployment states in every status. `DATABASE_URL` must explicitly identify a
local Postgres database:

```bash
bun run db:seed
```

Seeding is idempotent (upsert by fixed id), so running it again does not duplicate rows. To clear the fixed-id demo rows and reseed from scratch:

```bash
bun run db:seed:reset
```

Reset only deletes the exact rows this script owns, not the whole table, so any other data in those tables is left untouched.

Add `-- --dry-run` to either command to print the planned row counts without
writing. Per
[ADR 0007](docs/adr/0007-explicit-seed-data-and-fixture-policy.md), both
commands refuse to run when `DATABASE_URL` is missing or malformed, when
`NODE_ENV` or `VERCEL_ENV` is `production`, or when the URL is not Postgres on
a loopback host (`localhost`/`127.0.0.1`/`::1`) — Loopworks demo data must never
write into a database that isn't explicitly and obviously local.
