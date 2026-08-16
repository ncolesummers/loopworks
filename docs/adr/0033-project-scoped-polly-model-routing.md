# ADR 0033: Project-Scoped Polly Routing With Explicit Enforcement Boundaries

Status: Proposed
Date: 2026-08-15
Issue: [#267 — Project-scoped Polly orchestrator with subscription-aware model routing](https://github.com/ncolesummers/loopworks/issues/267)

## Context

LoopWorks delegates coding work through Omnigent across separately metered
OpenAI and Anthropic subscriptions. Generic vendor-named workers leave model
tier, reviewer independence, phase authority, and contributor provenance to
prompt-time judgment.

The first proposal overstated its containment. Direct-write policies did not
cover shell, reviewer bypass modes were enabled, outward-command approval was
disabled, an empty sandbox block had platform-dependent behavior, and the
Antigravity native harness did not enforce its worker prompt or policies. The
configured cwd guard also could not confine children to this repository's
sibling-worktree convention.

## Decision

Add `.omnigent/polly-loopworks/` with six role-named workers:

- `sol`, `luna`, `terra`, and `opus` are model-pinned implementers; and
- `reviewer_sol` and `reviewer_opus` are model-pinned reviewers from different
  providers.

Do not register a Gemini worker. The available Antigravity native executor
cannot bind the worker prompt, policy hook, or read-only sandbox, so it is not a
safe automated tiebreak.

Target the current bundle at the LoopWorks macOS host. Reviewers explicitly use
`darwin_seatbelt` with no workspace write grants, disable harness bypass modes,
deny direct edit tools, and deny all shell tools. A Linux deployment requires a
separate explicit `linux_bwrap` configuration and verified runtime support.

Use only public policy handlers under `omnigent.policies.builtins.*`. The
invariant suite imports every configured handler against a pinned Omnigent
source revision. CEL policies deny custom children, nested worker agent tools,
reviewer shell, Fable overrides, and pull-request merge commands. Reviewer
`blast_radius` uses `gate_pushes: true`; implementers retain `false` for the
authorized publication step, with merge denied separately.

Do not claim filesystem confinement for implementers. Empirical runtime
resolution demonstrated that `OMNIGENT_RUNNER_WORKSPACE` overrides even an
absolute worker cwd, and `sys_session_send` has no per-child cwd argument. The
managed workflow must be launched from the intended sibling issue worktree and
must stop before dispatch if effective cwd differs. Implementers are trusted
writers within that launch workspace until Omnigent exposes a binding
per-worker worktree mechanism.

Split worker craft into `tdd-implement`, `browser-validate`, and
`commit-signed-pr`. The human-facing issue skills compose those files and retain
single-agent behavior. Managed workers receive only phase craft, policies block
the human orchestration skills and agent-creation tools, every dispatch carries
a position/authority header, and `.polly/workflow-state.md` is append-only at
transitions.

Limit the managed bundle to one draft pull request. Supporting dependent layers
would require per-layer and assembled-diff review, validation, publication, and
provenance mapping not represented by this sequence.

Every PR body and handoff records the actual author and reviewer models and
providers and whether either reviewer shared the author's model lineage. This
replaces categorical independence stamps that can misdescribe a real run.

## Consequences

- Routing mistakes become roster/config changes instead of ad hoc model names.
- Review mutation is blocked through native sandbox, harness mode, edit-tool
  denial, and shell denial on the supported macOS host.
- Reviewers cannot run tests through shell; the review packet must contain all
  needed diff and test evidence.
- The bundle fails loudly rather than degrading to unsandboxed review on Linux.
- Gemini capacity is unavailable until its native harness gains a binding
  policy path.
- Automatic creation of a sibling worktree after the orchestrator starts is
  unsupported; the operator must launch from the prepared issue worktree.
- Managed dependent pull-request layers remain outside this workflow.
- The pinned external policy-source revision becomes a CI validation input and
  must be updated deliberately when the runtime changes.

## Validation

- `bun vitest run tests/unit/agent/polly-loopworks-spec.test.ts --reporter=verbose`
  exercises named invariants for roster, exact models, reviewer sandbox and
  shell denial, merge denial, nested-agent denial, public handler imports,
  phase skills, dispatch headers, and the ledger.
- A runtime resolver probe compares an absolute sibling-worktree candidate
  against the actual runner workspace and records the effective cwd.
- `bun run validate` remains the aggregate repository gate and runs serially.

## Follow-ups

- Add a Linux reviewer variant only after `linux_bwrap` startup and denial
  behavior are tested on the target host.
- Reconsider Gemini only when its native executor propagates prompts and policy
  decisions through an enforceable hook and sandbox.
- Replace the launch-cwd precondition when Omnigent provides a tested
  per-worker cwd/workspace boundary for sibling worktrees.
- Add managed dependent-layer orchestration only with per-layer and assembled
  evidence contracts.
