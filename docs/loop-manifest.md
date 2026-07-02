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

## Manifest Contract

The manifest is versioned. The current schema uses `version: 1` and requires at
least one entry in `loops`.

Each loop definition includes:

1. `key`, `name`, and `description` for stable identification.
2. `enabled` to stop new runs without deleting the loop contract.
3. `repoScope` with allowed repositories, branch patterns, and fork policy.
4. `triggers` with issue labels, blocked labels, issue event states, manual
   trigger support, and optional schedules.
5. `modelPolicy`, `toolPolicy`, and `budgets` to bound agent execution.
6. `approvals` describing high-impact actions, required reviewers, bypass
   policy, and evidence.
7. `artifacts` describing required plans, validation reports, diff summaries,
   PR intents, traces, and retention.
8. `validationGates` with deterministic commands and the rollout phase they
   protect.
9. `retryPolicy` with bounded attempts and backoff.
10. `concurrency` with the group key, max in-flight runs, and cancellation
    behavior for overlapping work.
11. `cancellation` for disabled or superseded work.
12. `githubWriteback` for approved comments, labels, or status checks.

The sample `development-loop` covers the `agent-ready` trigger and the early
validation path for issue-backed implementation work. It is a draft operating
contract, not a full runtime engine.

## Operating Rules

1. Do not advance a loop without recording why the state changed.
2. Do not hide blocked work; expose blockers directly in the UI.
3. Keep one issue as the smallest durable planning unit.
4. Use comments and labels for lightweight coordination, not separate shadow trackers.
5. Preserve enough history to reconstruct what happened after the fact.
6. Emit structured logs for trigger decisions, validation gates, retries, cancellations, approvals, and external writes.
7. Store durable records for audit state; do not rely on logs as the only source of truth.

## Change Governance

Manifest changes must be reviewable before rollout:

1. Propose the manifest as a diff in the issue or PR that changes loop
   behavior. GitHub remains the durable planning surface.
2. Validate the proposed manifest with the TypeScript schema and the checked-in
   JSON schema. Invalid manifests must report field paths, messages, and hints.
3. Add or update deterministic tests for changed triggers, enabled state,
   validation gates, approvals, retries, concurrency, or cancellation behavior.
4. Add eval coverage when model policy, prompt/tool access, or workflow behavior
   changes in a way deterministic tests cannot fully judge.
5. Require PR review for any change that expands write access, changes approval
   gates, loosens validation, raises budgets, changes concurrency, or changes
   GitHub writeback behavior.
6. Record rollout notes that identify the manifest version, affected loop keys,
   validation evidence, reviewer approval, and rollback or disable path.

## Milestone Contract

### M0 Project Foundation

Define the operational baseline, repo conventions, docs, and data model.
Persona test IDs: P01, P03, R02, S04.

### M1 Design System Direction + App Shell

Establish the UI vocabulary before the app becomes too broad.
Persona test IDs: P01, P04, M01, A02, R02.

### M2 GitHub + Vercel Source Systems

Wire the external systems that supply truth about work and deployment state.
Persona test IDs: P02, M01, M03, R01, S01, S02, S03.

### M3 Durable Loop MVP

Ship the first end-to-end loop with persisted history.
Persona test IDs: M02, A01, A02, A03, R01.

### M4 Validation + PR Path + MVP Security Review

Add release confidence, review visibility, and security signoff.
Persona test IDs: A03, R01, R02, S01, S02, S03, S04.

### M5 Agent Governance + Evals

Add guardrails and scenario coverage for agent behavior.
Persona test IDs: P03, A02, A03, R02, S04.
