# ADR 0015: Stage Orchestrator And Isolated Subagent Handoffs

Status: Proposed
Date: 2026-07-13

Driving issues: [#47](https://github.com/ncolesummers/loopworks/issues/47),
[#48](https://github.com/ncolesummers/loopworks/issues/48), and
[#49](https://github.com/ncolesummers/loopworks/issues/49), and
[#50](https://github.com/ncolesummers/loopworks/issues/50)

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

The root orchestrator and planner use `openai/gpt-5.6-sol`; the test-writer,
implementer, validation-reviewer, and PR-preparer use `openai/gpt-5.6-terra`. Each retains
independent `xhigh` reasoning configuration so model routing can evolve per
stage without changing the shared topology.

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

Validation owns browser screenshot evidence rather than the reviewer. A
deterministic UI classification checks production app, component, and style
paths plus browser or Storybook coverage in the persisted test plan. UI runs
must persist `loopworks.screenshot_evidence.v1`, bound to the repository commit,
test-plan digest, and production-patch digest. It contains one PNG reference for
every browser test at `390x844`, `1280x832`, and `1440x960`; non-UI runs persist
an explicit empty manifest. Missing journeys, captures, or mismatched digests
block validation.

The validation-reviewer is a sibling with deny-all runtime egress and guarded,
commit-pinned repository reads. It consumes only the persisted plan, test plan,
implementation result, passing validation report, and screenshot manifest. It
emits `loopworks.validation_review_result.v1`: bounded findings with exact
validation and screenshot citations plus one `commit`, `development`, or
`test-writing` recommendation. It has no GitHub, generic write, or durable
transition tool. The root alone validates and applies that result.

Backward recommendations are bounded cycles, not new runs. The control plane
preserves the approved plan, increments and requeues the affected existing step
rows, clears execution claims, resets invalidated artifact contracts, and
records prior review attempt, digest, and route metadata. `development` resets
development through code review; `test-writing` also resets test writing. The
manifest retry budget bounds both routes. Exact replay is idempotent and a
conflicting replay fails closed.

The PR-preparer is a sibling with independent Terra/xhigh configuration,
deny-all egress, no repository checkout, and only bounded readers for issue,
validation, review, completed artifact, deployment, and screenshot evidence.
It emits `loopworks.pr_preparation_result.v1`, binding bounded narrative and a
nested `loopworks.pr_intent.v1` to the approved plan, repository revision,
validation report, review result, screenshot manifest, completed artifact set,
optional deployment context, run, and PR attempt. The root validates and
persists the result; only ADR 0014's guarded transition may use it for GitHub.

## Consequences

Each stage can tune its model and capabilities independently without granting
the planner repository mutation rights. Durable artifact handoffs make isolated
sandboxes reproducible and reviewable, at the cost of versioned patch contracts,
additional artifact persistence, and strict transition checks.

The root becomes orchestration-only. Stage ordering and approval checks remain
deterministic control-plane behavior rather than model judgment.

## Validation

1. Eve discovery reports the root plus declared `planner`, `test-writer`,
   `implementer`, `validation-reviewer`, and `pr-preparer` subagents without
   diagnostics.
2. Unit tests cover tool allowlists, fixture fail-closed behavior, patch safety,
   AC coverage, red-evidence classification, and sanitized telemetry.
3. PGlite tests prove exact plan approval, two-artifact persistence, idempotency,
   and advancement only for complete expected-red evidence.
4. Eve eval discovery includes planner, test-writing, implementation,
   validation-review, and PR-preparation routing scenarios.
5. Validation-review transition tests cover forward routing, both backward
   cycles, retry bounds, claims, artifact reset, stale bindings, and replay.
6. Screenshot tests cover deterministic UI classification, three required
   viewports, digest-bound writer output, non-UI manifests, and incomplete
   evidence.
7. PR-preparation tests cover exact evidence binding, non-UI empty manifests,
   idempotent persistence, conflicting replay, and guarded-writer approval.
8. `bun run validate` and `bun run build` pass before review.

## Follow-Ups

1. **Done by issue #48.** The implementer consumes the persisted test-only
   patch and produces the smallest green implementation patch in a separate
   sandbox.
2. **Done by issue #49.** The validation-reviewer consumes passing deterministic
   evidence and recommends a root-controlled forward or bounded backward route.
3. **Done by issue #50.** The PR-preparer emits evidence-bound intent while the
   root and guarded writer retain all persistence and GitHub authority.
4. Issues #44-#46 and #51 implement additional sibling subagents under this
   orchestration contract.
5. Accept this ADR only after maintainer review of the sibling-stage rollout.
