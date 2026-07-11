# ADR 0013: Eve Planning Agent Contract

Status: Proposed
Date: 2026-07-03

## Context

Issue [#13](https://github.com/ncolesummers/loopworks/issues/13) introduces the
first Eve-based planning agent. The agent must make GitHub issues executable
without becoming an autonomous code mutation path. It also needs enough
observability to support later operations while ADR
[0012](0012-telemetry-backend-and-metric-contract.md) owns the telemetry backend
and metric contract.

## Decision

Loopworks defines the planner as an Eve-backed planning-only declared subagent
under the neutral stage orchestrator established by ADR
[0015](0015-stage-orchestrator-and-isolated-subagent-handoffs.md). This 2026-07-11
placement update preserves the original planning contract while removing stage
orchestration from the planner. The subagent emits a typed plan artifact containing issue metadata, stages, validation
gates, approval points, risks, fixture mode, eval coverage, and tool-contract
summary. The selected planning model is `openai/gpt-5.6-sol` with OpenAI
reasoning effort `xhigh`, reported in artifacts as
`openai/gpt-5.6-sol-xhigh`.

The model-visible CLI surface is a guarded `bash` replacement for read-only
inspection through tools such as `gh`, `az`, and read-only `git` commands.
Repository writes, file writes, branch changes, pull request changes, issue
mutation, deployment changes, and SaaS mutation verbs are blocked. The only
write-like planning contract is emitting the validated plan artifact.

Production structured logs stay enabled and carry sanitized metadata and
correlation fields. Raw input/output capture is disabled in production until the
ADR 0012 implementation work defines filtering, masking, and exporter topology.
Non-production may opt in to raw IO capture for eval/debug validation with
explicit environment configuration.

Fixture mode is explicit and local-only. It requires
`LOOPWORKS_EVE_FIXTURE_MODE=true` and fails closed in production-like runtimes.

## Consequences

Planning can use SaaS CLIs for context gathering without granting a generic
shell or source mutation surface. The first agent contract is testable through
deterministic golden fixtures and Eve eval discovery before broader model,
prompt, or tool changes.

The planner no longer owns the root Eve runtime. It is a sibling of other stage
subagents and cannot invoke them or transition durable run state.

The implementation intentionally defers telemetry exporter wiring, production
masking policy, metrics backend activation, and trace collector setup to ADR
0012 implementation work.

## Validation

1. Unit tests cover the plan artifact schema, CLI guard, fixture fail-closed
   behavior, and sanitized telemetry policy.
2. Development-loop persistence stores the rich plan artifact in
   `agent_plans.plan`.
3. `bunx eve eval --list` discovers the planning eval harness without requiring
   a live model call.
4. Aggregate validation and build pass before review.

## Follow-Ups

1. Link this Proposed ADR from issue #13 before accepting or merging the
   architecture decision.
2. ADR 0012 implementation work will wire backend/exporter topology and
   production filtering or masking policy.
