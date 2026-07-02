# Architecture Decision Records

Loopworks uses ADRs for durable technical and product architecture decisions. GitHub Issues remain the planning source of truth, but accepted decisions should be captured here so future agents and maintainers can understand the constraints they are working inside.

## Lifecycle

1. Proposed: the decision is under discussion and should be linked from a GitHub issue.
2. Accepted: the decision is active and implementation should follow it.
3. Superseded: a later ADR changed the decision.
4. Deprecated: the decision remains historical context but should not guide new work.

## Decision lifecycle & GitHub integration

- **Add** — when a non-trivial durable decision surfaces while working an issue, open a *Proposed* ADR and link it from that issue. GitHub Issues remain the planning source of truth; the ADR captures the durable decision.
- **Update** — when a decision's details change but its direction holds, edit the ADR in place and note the change.
- **Supersede** — when a later decision replaces an earlier one, write a new ADR that states `Supersedes NNNN`, set the old ADR's status to `Superseded by MMMM`, and update the Current Records table. Never leave an active decision orphaned: if a superseding ADR only covers part of the old one, carry the still-active parts forward into the new ADR so a reader of the live set can still find them.
- **Link** — every Proposed or Accepted ADR links its driving issue; conversely, architecture-changing issues should reference the relevant ADR in their acceptance criteria.
- **Which decisions start as Proposed** — changes to architecture, external integrations, the data model, the observability/metrics contract, security posture, or design-system direction should open as *Proposed* (linked from the driving issue) and only move to *Accepted* after review. Smaller reversible choices do not need an ADR.

## Current Records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-github-issues-as-source-of-truth.md) | Accepted | Use GitHub Issues as the planning and execution source of truth. |
| [0002](0002-vercel-stack-for-app-and-agent-infrastructure.md) | Accepted | Use the Vercel stack for app hosting, deployment visibility, and agent infrastructure expansion. |
| [0003](0003-pino-structured-logging-and-metrics-contract.md) | Accepted | Use Pino structured logging and define the metrics/traces contract early. |
| [0004](0004-postgres-and-drizzle-for-control-plane-state.md) | Accepted | Use Postgres and Drizzle for control-plane persistence. |
| [0005](0005-shadcn-ui-as-component-foundation.md) | Superseded by [0009](0009-design-system-direction-and-tokens.md) | Use ShadCN/UI as the component foundation while designing Loopworks-specific tokens early. |
| [0006](0006-deterministic-validation-tdd-playwright-storybook.md) | Accepted | Use deterministic validation, TDD practice, Playwright, and Storybook as first-class quality gates. |
| [0007](0007-explicit-seed-data-and-fixture-policy.md) | Accepted | Use explicit seed data and fixtures for local/dev stand-ins without silent production fallback. |
| [0008](0008-agent-instruction-scope-and-sync.md) | Accepted | Use directory-scoped AGENTS.md files as canonical agent guidance and generated Claude import shims. |
| [0009](0009-design-system-direction-and-tokens.md) | Accepted | Adopt a monochrome neutral base with one blue accent, Mona Sans and Monaspace Neon typography, an HSL token system, and a centralized STATUS_META vocabulary as the M1 design system. |
| [0010](0010-storybook-first-visual-regression-strategy.md) | Accepted | Use Storybook stories, native a11y review, and human review as the M1 visual-regression strategy before durable screenshot baselines. |
| [0011](0011-approval-transition-audit-events.md) | Proposed | Store approval transition audit events alongside current approval state. |

## Template

```markdown
# ADR NNNN: Title

Status: Proposed | Accepted | Superseded | Deprecated
Date: YYYY-MM-DD

## Context

What pressure or uncertainty forced this decision?

## Decision

What are we choosing?

## Consequences

What gets easier, harder, or constrained?

## Validation

How will we know the decision is being followed?

## Follow-Ups

What issues, docs, tests, or implementation work remain?
```
