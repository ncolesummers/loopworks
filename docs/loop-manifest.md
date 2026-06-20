# Loop Manifest

## Purpose
This document defines the operating contract for Loopworks. It explains how work enters the system, how it moves, and what the portal must preserve for auditability.

## Source of Truth
1. GitHub Issues are the source of truth for backlog intent.
2. GitHub milestones define delivery stages.
3. GitHub labels define type, area, priority, and status.
4. The portal may derive summaries, but it should not become the canonical backlog store.

## Loop Model
Each loop should have:
1. A scope defined by one or more issues.
2. A current state.
3. A history of transitions and external sync events.
4. A visible owner or actor for each important transition.
5. A validation and review outcome before closure.
6. Observability contracts for logs, metrics, traces, artifacts, and correlation identifiers.

## Recommended Loop States
1. Intake
2. Triage
3. Planned
4. In Progress
5. Waiting on Review
6. Validating
7. Blocked
8. Done

## Required Metadata
Every tracked item should carry:
1. Repo context.
2. Milestone.
3. Area label.
4. Priority label.
5. Current state.
6. Last synced timestamp.
7. Source links to issues, PRs, and deployments.

## Operating Rules
1. Do not advance a loop without recording why the state changed.
2. Do not hide blocked work; expose blockers directly in the UI.
3. Keep one issue as the smallest durable planning unit.
4. Use comments and labels for lightweight coordination, not separate shadow trackers.
5. Preserve enough history to reconstruct what happened after the fact.
6. Emit structured logs for trigger decisions, validation gates, retries, cancellations, approvals, and external writes.
7. Store durable records for audit state; do not rely on logs as the only source of truth.

## Milestone Contract
### M0 Project Foundation
Define the operational baseline, repo conventions, docs, and data model.

### M1 Design System Direction + App Shell
Establish the UI vocabulary before the app becomes too broad.

### M2 GitHub + Vercel Source Systems
Wire the external systems that supply truth about work and deployment state.

### M3 Durable Loop MVP
Ship the first end-to-end loop with persisted history.

### M4 Validation + PR Path + MVP Security Review
Add release confidence, review visibility, and security signoff.

### M5 Agent Governance + Evals
Add guardrails and scenario coverage for agent behavior.
