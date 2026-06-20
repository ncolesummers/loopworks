# ADR 0001: GitHub Issues As Source Of Truth

Status: Accepted
Date: 2026-06-20

## Context

Loopworks is an agentic software factory, but it should not become a parallel project management system. The durable planning and collaboration objects already exist in GitHub: issues, labels, milestones, Projects, PRs, reviews, checks, comments, branches, and commits. Agentic workflows need more operational state than GitHub should hold, including run steps, artifacts, retries, locks, traces, costs, and approval transitions.

## Decision

GitHub Issues are the canonical work item and planning source for Loopworks. Issues hold roadmap intent, plans, milestones, decisions, durable execution updates, and state visible to humans.

Loopworks stores low-level control-plane state internally and writes summaries, status, and durable links back to GitHub. Loopworks must avoid using GitHub comments as an event store.

## Consequences

This keeps planning where developers already work and makes automation auditable through familiar GitHub surfaces. It also means Loopworks needs careful idempotency, locking, and reconciliation when GitHub sends duplicate webhooks or when issue state changes outside the portal.

The portal can cache, normalize, and derive GitHub state, but it must make clear which state is source-system state and which state is Loopworks operational state.

## Validation

1. Product docs and issue templates treat GitHub Issues as the durable work object.
2. Webhook processing records idempotency and normalized event state before starting loops.
3. Run details link back to the source issue and PR where available.
4. GitHub writebacks are summaries and links, not per-step event dumps.

## Follow-Ups

1. Define the exact GitHub App permissions for issue intake, PR creation, checks, and comments.
2. Add reconciliation behavior for issue label changes and closed/reopened events.
3. Add issue comment conventions for run summaries and ADR proposals.
