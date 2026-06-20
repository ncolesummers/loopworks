# Loopworks Agent Guide

Loopworks agent work must be issue-backed, scoped, deterministic, observable,
secure, and reviewable.

## Always

1. Preserve user work; never revert unrelated changes without explicit request.
2. Use GitHub Issues for durable product work, decisions, plans, and execution
   state.
3. Follow TDD: write/update tests, show red, then make the smallest green
   change.
4. Read relevant ADRs before changing architecture, integrations,
   observability, testing, fixtures, or workflow governance.
5. Update docs, ADRs, personas, or backlog artifacts when those expectations
   change.
6. Delegate with subagents only when tool policy allows it and scopes are
   concrete and disjoint.

## Routing

Before changing a scoped area, read its nearest guide:

- `src/AGENTS.md`: app, auth, DB, integrations, routes.
- `src/components/AGENTS.md`: reusable UI.
- `src/lib/observability/AGENTS.md`: logging, metrics, traces.
- `tests/AGENTS.md`: Vitest, Playwright, fixtures.
- `docs/AGENTS.md`: product, architecture, personas, security docs.
- `docs/adr/AGENTS.md`: ADRs.
- `agent/AGENTS.md`: Eve and agent orchestration.
- `scripts/AGENTS.md`: repository scripts and bootstrap tooling.
- `.github/AGENTS.md`: workflows and issue templates.

## Validation

Run focused checks while working. For broad changes run `bun run validate`. For
app/runtime changes also run `bun run build`. Before committing, run
`bun run precommit` or let `pre-k` run it.

## Agent Docs

`AGENTS.md` is canonical. `CLAUDE.md` files are generated import shims. Do not
hand-edit them; after changing any `AGENTS.md`, run `bun run agent-docs:sync`.
