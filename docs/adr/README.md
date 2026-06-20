# Architecture Decision Records

Loopworks uses ADRs for durable technical and product architecture decisions. GitHub Issues remain the planning source of truth, but accepted decisions should be captured here so future agents and maintainers can understand the constraints they are working inside.

## Lifecycle

1. Proposed: the decision is under discussion and should be linked from a GitHub issue.
2. Accepted: the decision is active and implementation should follow it.
3. Superseded: a later ADR changed the decision.
4. Deprecated: the decision remains historical context but should not guide new work.

## Current Records

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-github-issues-as-source-of-truth.md) | Accepted | Use GitHub Issues as the planning and execution source of truth. |
| [0002](0002-vercel-stack-for-app-and-agent-infrastructure.md) | Accepted | Use the Vercel stack for app hosting, deployment visibility, and agent infrastructure expansion. |
| [0003](0003-pino-structured-logging-and-metrics-contract.md) | Accepted | Use Pino structured logging and define the metrics/traces contract early. |
| [0004](0004-postgres-and-drizzle-for-control-plane-state.md) | Accepted | Use Postgres and Drizzle for control-plane persistence. |
| [0005](0005-shadcn-ui-as-component-foundation.md) | Accepted | Use ShadCN/UI as the component foundation while designing Loopworks-specific tokens early. |
| [0006](0006-deterministic-validation-tdd-playwright-storybook.md) | Accepted | Use deterministic validation, TDD practice, Playwright, and Storybook as first-class quality gates. |
| [0007](0007-explicit-seed-data-and-fixture-policy.md) | Accepted | Use explicit seed data and fixtures for local/dev stand-ins without silent production fallback. |
| [0008](0008-agent-instruction-scope-and-sync.md) | Accepted | Use directory-scoped AGENTS.md files as canonical agent guidance and generated Claude import shims. |

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
