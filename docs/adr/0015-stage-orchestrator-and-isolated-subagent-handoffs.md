# ADR 0015: Stage Orchestrator And Isolated Subagent Handoffs

Status: Proposed
Date: 2026-07-11

Driving issue: [#47](https://github.com/ncolesummers/loopworks/issues/47)

## Context

The development loop needs planning, test-writing, implementation, review, PR,
and completion specialists. Eve declared subagents can select independent models
and narrow tool surfaces, but each owns an isolated sandbox. Nesting later stages
under the planning agent would give planning the wrong authority, while relying
on shared workspace state would prevent per-stage model selection and durable
handoffs.

## Decision

Loopworks uses one neutral Eve root as the stage orchestrator. Planner,
test-writer, and future stage specialists are declared sibling subagents with
independent model, instruction, tool, and sandbox contracts. The orchestrator
reads durable run state, verifies approval and artifact prerequisites, delegates
one stage, validates the typed result, and invokes deterministic control-plane
transitions.

The root orchestrator and planner use `openai/gpt-5.6-sol`; the test-writer
uses `openai/gpt-5.6-terra`. Each retains independent `xhigh` reasoning
configuration so model routing can evolve per stage without changing the
shared topology.

Planner, test-writer, and implementer receive repository-scoped discovery, text
search, and line-range read tools against their isolated commit-pinned
checkouts. The tools
exclude secret, generated, dependency, and traversal paths; bound queries and
outputs; reject symlink escape; and return commit/path/line provenance. The
framework's permissive filesystem tools remain disabled. Planner web access is
a separate guarded capability tracked by issue #68.

Stage subagents do not mutate GitHub or durable workflow state. They communicate
through versioned artifacts. Because declared subagent sandboxes are isolated,
test-writing hands its repository changes forward as a bounded, SHA-256-bound,
test-only unified patch inside `loopworks.test_plan.v1`. Red evidence is stored
with a control-plane-verifiable execution receipt binding the exact command,
test path, expected assertion, redacted-output digest, and patch digest. This
prevents a stage response from self-attesting that unexecuted tests are red.
The evidence is stored separately as `loopworks.red_test_evidence.v1` in the stage's
`validation_report` artifact.

Test writing requires an `approved` `plan-review` record bound to the run, plan
row, and canonical plan digest. Requested, rejected, expired, bypassed, stale,
or mismatched approvals fail closed. Expected assertion failures complete the
test-writing stage successfully; environment, setup, timeout, crash, unrelated,
or passing results do not advance the run.

The implementation sibling uses `openai/gpt-5.6-terra` with independent
`xhigh` reasoning configuration. It consumes the exact persisted test plan,
test-only patch, red evidence, and fixture records without re-derivation. Its
guarded tools apply that patch once, permit one bounded production-only write,
run every exact planned test plus `bun run validate`, and emit
`loopworks.implementation_result.v1`. Signed green receipts bind the plan,
test-plan, test-patch, production-patch, command, paths, and redacted output
digests. The root revalidates the approval and complete handoff before storing
the result in the existing development `patch` artifact and advancing to the
separate validation stage.

## Consequences

Each stage can tune its model and capabilities independently without granting
the planner repository mutation rights. Durable artifact handoffs make isolated
sandboxes reproducible and reviewable, at the cost of versioned patch contracts,
additional artifact persistence, and strict transition checks.

The root becomes orchestration-only. Stage ordering and approval checks remain
deterministic control-plane behavior rather than model judgment.

## Validation

1. Eve discovery reports the root plus declared `planner`, `test-writer`, and
   `implementer` subagents without diagnostics.
2. Unit tests cover tool allowlists, fixture fail-closed behavior, patch safety,
   AC coverage, red-evidence classification, and sanitized telemetry.
3. PGlite tests prove exact plan approval, two-artifact persistence, idempotency,
   and advancement only for complete expected-red evidence.
4. Eve eval discovery includes planner, test-writing, and implementation
   routing scenarios.
5. `bun run validate` and `bun run build` pass before review.

## Follow-Ups

1. **Done by issue #48.** The implementer consumes the persisted test-only
   patch and produces the smallest green implementation patch in a separate
   sandbox.
2. Issues #44-#46 and #49-#51 implement additional sibling subagents under this
   orchestration contract.
3. Accept this ADR only after maintainer review of issue #47.
