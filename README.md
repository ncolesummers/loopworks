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

## Environment

Copy `.env.example` to `.env.local` for local development. The fixture server only needs the defaults from `.env.example`; real GitHub SSO, webhooks, database persistence, and Vercel deployment visibility use these variables:

- `AUTH_SECRET`
- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `LOOPWORKS_AUTH_BYPASS`
- `LOOPWORKS_ALLOWED_GITHUB_USERS`
- `LOOPWORKS_ALLOWED_GITHUB_ORGS`
- `LOOPWORKS_AGENT_READY_LOOP_ENABLED`
- `LOOPWORKS_DEVELOPMENT_LOOP_ENABLED`
- `LOOPWORKS_RESEARCH_LOOP_ENABLED`
- `LOG_LEVEL`
- `DATABASE_URL`
- `GITHUB_APP_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`
- `VERCEL_ACCESS_TOKEN`
- `VERCEL_TEAM_ID`
- `VERCEL_TEAM_SLUG`

## Validation

```bash
bun run format:check
bun run lint
bun run agent-docs:check
bun run markdownlint
bun run typecheck
bun run test
bun run storybook:build
bun run test:e2e
```

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

## GitHub Bootstrap

After the repository exists and `gh` can mutate it:

```bash
bun run bootstrap:github
```

Use `--dry-run` to print the planned labels, milestones, issues, and project setup without changes.
