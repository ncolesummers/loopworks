# ADR 0033: Project-Scoped Polly Model Routing And Review Isolation

Status: Proposed
Date: 2026-08-15
Issue: [#267 — Project-scoped Polly orchestrator with subscription-aware model routing](https://github.com/ncolesummers/loopworks/issues/267)

## Context

LoopWorks delegates coding work through Omnigent's Polly orchestrator across
three independently metered subscriptions. The upstream Polly bundle exposes
workers by vendor and permits model selection at dispatch time. That makes the
project's cost/quality routing policy a repeated prompt-time judgment and does
not structurally prevent a reviewer from editing the implementation.

The single-agent `implement-issue-pr` workflow also assigns test planning, TDD,
review, validation, and publication to one session. An orchestration-only root
must distribute those phases without breaking the red-before-green evidence
chain, cross-review independence, or signed contributor provenance.

## Decision

Add a repository-scoped Omnigent bundle at `.omnigent/polly-loopworks/` with a
restricted, role-named roster:

- `sol`, `luna`, `terra`, and `opus` are model-pinned implementing tiers;
- `reviewer_sol` and `reviewer_opus` are model-pinned adversarial reviewers on
  different vendors; and
- `gemini` is an unpinned, read-only tiebreak worker because its antigravity
  harness exposes only a default model.

Implementers carry `worktree_guard`. Reviewers use the platform's read-only OS
sandbox and `read_only_os`, so reviewer mutation is denied by mechanism rather
than prompt convention. A purpose guard requires every dispatch to declare its
role, spawn bounds cap per-turn fan-out, and a CEL policy denies nested
`args.model: claude-fable-5`. Fable remains available only through an explicit,
reviewable policy change because its DeepSWE score is lower than Opus 5 at equal
token burn.

Every issue implementation receives two fresh reviewers in parallel, one Sol
and one Opus, using a file-based handoff containing only issue, acceptance
criteria, test plan, and diff. The author reconciles findings; the orchestrator
never edits or merges. Reviewer configs explicitly select the portable platform
sandbox and carry `read_only_os`. If a preferred model is throttled, the
workflow may override the model on the read-only `reviewer_sol` config. It never
dispatches a writable implementer as a reviewer, announces any fallback, stamps
only an actual loss of vendor independence, and stops publication if two
read-only reviewers cannot run. Custom child creation is denied so it cannot
bypass the declared roster or model policy.

The bundle-local `implement-issue-pr` skill keeps test planning and TDD in one
implementing session, runs validation gates serially, and leaves commit,
signing, push, draft PR creation, and GitHub provenance with the implementing
worker. This preserves the real contributor identity while keeping the root
orchestration-only.

## Consequences

Routing choices become inspectable configuration and named roles instead of
ad-hoc model strings. The scarce Sol and Opus allowances are protected by Luna,
Terra, and provider spill, while every publication retains two structurally
read-only reviews.

The roster intentionally duplicates harnesses to pin tier models. Adding or
renaming a worker requires updating both `tools.agents` and the physical
`agents/` directory because Omnigent discovers every directory independently.
The Gemini tiebreak remains unavailable for required decisions until its
harness passes a smoke test. A provider outage may preserve two reviewers but
lose vendor independence; that degradation must be visible in the PR and
handoff.

## Validation

1. `tests/unit/agent/polly-loopworks-spec.test.ts` parses the orchestrator and
   worker YAML, checks the exact roster and model pins, and enforces role
   guardrails and the nested Fable deny expression.
2. The same suite checks phase ownership, serial validation, file-based parallel
   review, author reconciliation, degraded-review disclosure, and the no-merge
   boundary.
3. `bun run check` and `bun run validate` verify formatting, static analysis,
   Markdown, agent-doc synchronization, tests, and repository security gates.
4. Two fresh read-only reviewers attack the issue contract, test plan, and
   proposed diff before publication and re-review the final diff.

## Follow-Ups

1. Smoke-test the `antigravity-native` harness before enabling Gemini tiebreaks.
2. Revisit allowance estimates and aliases when subscription catalogs change.
3. Keep upstream Polly improvements under review and deliberately port relevant
   guardrail changes into this project-scoped fork.
