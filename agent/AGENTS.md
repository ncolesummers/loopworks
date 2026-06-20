# Agent Orchestration Guide

## Scope

This guide applies to Eve and other agent orchestration code under `agent/`.

## Rules

1. Keep agent behavior issue-backed, auditable, and deterministic where
   possible.
2. Define plans, acceptance criteria, validation evidence, and handoff state
   before execution.
3. Treat external writes as approval-gated actions with clear attribution.
4. Keep prompt and workflow contracts typed and reviewable.
5. Add structured logs and trace context at orchestration boundaries.
6. Do not store secrets, raw prompts, or unreviewed payloads in logs.

## Tests

Cover planning contracts, state transitions, approval boundaries, and failure
paths when orchestration behavior changes.
