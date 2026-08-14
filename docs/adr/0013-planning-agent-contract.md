# ADR 0013: Eve Planning Agent Contract

Status: Accepted
Date: 2026-07-03
Accepted: 2026-08-13 after issue [#13](https://github.com/ncolesummers/loopworks/issues/13)
review, direct ADR backlink, [PR #61](https://github.com/ncolesummers/loopworks/pull/61)
merge, and [PR #176](https://github.com/ncolesummers/loopworks/pull/176) security hardening

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

The planner has no model-visible CLI or general shell. The neutral root's
disabled `bash` contract remains authoritative, and the planner does not
override it. Issue context is supplied by the host, while repository discovery,
search, and line-range reads use bounded tools against the isolated,
commit-pinned checkout defined by ADR 0015. The only write-like planning
contract is emitting the validated plan artifact.

Three typed, host-owned GitHub tools preserve planning-critical backlog access:
bounded issue listing, one-item detail with comments and relationships, and
label/milestone taxonomy. They accept only bounded filters or an issue number,
never repository, installation, run, route, method, page, or credential input.
The host derives the durable run ID from the initiating authenticated Eve
principal's `loopworks.run_id` claim. Declared subagents inherit that initiator
authority, while later callers and model input cannot replace it. Host code
then resolves the run's repository and GitHub App installation, calls fixed GET
routes, projects explicit returned fields, redacts and caps text, reports
truncation, and maps provider failures to stable errors. GitHub prose is
untrusted external evidence, not instruction authority.

Azure inventory and GitHub Projects V2 remain separately issue-backed because
they need different durable scope bindings and provider permissions; issues
[#173](https://github.com/ncolesummers/loopworks/issues/173) and
[#174](https://github.com/ncolesummers/loopworks/issues/174) own those contracts.
A command denylist is not an acceptable substitute because child processes can
inherit host credentials and read-only commands can return secrets.

Production structured logs stay enabled and carry sanitized metadata and
correlation fields. Raw input/output capture is disabled in production until the
ADR 0012 implementation work defines filtering, masking, and exporter topology.
Non-production may opt in to raw IO capture for eval/debug validation with
explicit environment configuration.

Fixture mode is explicit and local-only. It requires
`LOOPWORKS_EVE_FIXTURE_MODE=true` and fails closed in production-like runtimes.

## Consequences

Planning uses supplied issue context, adaptive run-bound GitHub backlog reads,
and commit-pinned repository inspection without a child-process credential or
raw CLI-output boundary. The additional host/provider boundary and untrusted
prose increase schema, redaction, and truncation work, but preserve the backlog
context needed for accurate plans.

The planner no longer owns the root Eve runtime. It is a sibling of other stage
subagents and cannot invoke them or transition durable run state.

The implementation intentionally defers telemetry exporter wiring, production
masking policy, metrics backend activation, and trace collector setup to ADR
0012 implementation work.

## Validation

1. Unit tests cover the plan artifact schema, absence of planner CLI authority,
   fixed GitHub routes, returned-field projection, redaction, truncation,
   fixture fail-closed behavior, and sanitized telemetry policy.
2. PGlite tests prove repository, installation, and current-issue identity come
   from the durable run binding and fail closed when incomplete or inconsistent.
3. Development-loop persistence stores the rich plan artifact in
   `agent_plans.plan`.
4. `bunx eve eval --list` discovers the planning eval harness without requiring
   a live model call.
5. Aggregate validation and build pass before review.
6. Issue #172 and [PR #176](https://github.com/ncolesummers/loopworks/pull/176)
   removed the planner CLI override, installed the run-bound typed GitHub
   backlog adapters, and passed two independent adversarial reviews.

## Follow-Ups

1. ADR 0012 implementation work will wire backend/exporter topology and
   production filtering or masking policy.
2. Issues #173 and #174 own Azure inventory and GitHub Projects V2 inspection.
