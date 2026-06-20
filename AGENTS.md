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

## Design Context

Durable design direction for all UI work. Full rationale and tokens live in
`docs/adr/0009-design-system-direction-and-tokens.md`; the pre-merge gate is
`docs/design-review-checklist.md`.

### Users

Operators of an agentic software-factory control plane — engineers running repo
intake, loops, runs, deploys, and approval gates for repeated daily use. They
need dense, scannable surfaces focused on state, evidence, and next actions, not
a marketing page or a decorative dashboard.

### Brand personality

Calm, precise, operational. The interface should evoke confidence and control,
not delight or urgency. It is serious engineering tooling.

### Aesthetic direction

Geist-inspired monochrome. Near-pure-neutral base; the primary action is
near-black (light) / near-white (dark). One restrained blue accent for links,
focus, and `info`; color otherwise appears only for semantic status. Light and
dark are both first-class. Fonts: Mona Sans (UI) and Monaspace Neon
(IDs/SHAs/logs). Anti-references: generic ShadCN/v0 defaults, the over-exposed
Geist typeface, navy-tinted darks, and marketing-style decoration.

### Design Principles

1. Functional over decorative; tokens and shared primitives over one-off styles.
2. Color carries meaning — reserve it for status and keep chrome monochrome.
3. Use the `StatusBadge` vocabulary (`STATUS_META`) for all state; never ad hoc.
4. Accessible by default: WCAG AA contrast in both themes (axe-enforced),
   keyboard-operable, with a visible focus ring.
5. Minimal, meaningful motion; always honor `prefers-reduced-motion`.
6. Stable dimensions — no layout shift across loading, empty, and error states.
