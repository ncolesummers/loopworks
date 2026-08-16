# ADR 0034: Project-Scoped Polly Routing With Explicit Enforcement Boundaries

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

Target the current bundle at the LoopWorks macOS host. Reviewer configs request
`darwin_seatbelt` with no workspace write grants, disable harness bypass modes,
and configure direct-edit and shell rejection. A Linux deployment requires a
separate explicit `linux_bwrap` configuration and verified runtime support.

Use only public policy handlers under `omnigent.policies.builtins.*`. The
invariant suite imports every configured handler against a pinned Omnigent
source revision. CEL policies target custom children, nested worker agent
tools, reviewer shell, Fable overrides, and common pull-request merge command
forms. Reviewer `blast_radius` uses `gate_pushes: true`; implementers retain
`false` for the authorized publication step.

Treat the merge command pattern only as a best-effort speed bump. It recognizes
several common layouts: repository flags before or after `pr`, compact `-R`,
REST merge endpoints, and GraphQL `mergePullRequest` mutations. It does not
enumerate every valid CLI or API spelling; shell indirection and other clients
can bypass string matching. The durable control is GitHub branch protection or
a worker token without merge scope. Both are out of scope for this PR, so the
bundle records rather than conceals that enforcement gap.

Function-policy `on:` fields are ignored at the pinned Omnigent revision, so
omit them and rely on each handler to self-select its event shape. More
importantly, the policy hook for every codex-native worker can fail open when
the Codex app-server is too old or workspace trust is rejected. This affects
the implementers `sol`, `luna`, and `terra`, plus `reviewer_sol`. Omnigent
reports `policy_hook_disabled_reason` once, but this bundle has no executable
preflight that consumes it. In that degraded state merge, nested-agent, and
skill policies do not bind for the implementers; `reviewer_sol` also loses
direct-write and shell policies. Keep these workers for routing capacity, but
record this residual risk instead of claiming the YAML is a containment
boundary.

Do not claim filesystem confinement for implementers. No checked-in runtime
probe demonstrates a binding per-worker relocation or confinement mechanism.
The managed workflow must be launched from the intended sibling issue worktree
and instructs the orchestrator to stop before dispatch if effective cwd differs.

That phase-one check is self-attested by an unsandboxed orchestrator whose
terminal retains `allow_cwd_override: true`. Implementers remain unrestricted
writers with `gate_pushes: false` for authorized publication. A mistaken launch
can therefore expose the main checkout and ungated pushes. Changing either flag
without verifying that approval prompts remain answerable would risk blocking
phase-eight publication, so this PR records rather than conceals the residual
risk.

Split worker craft into `tdd-implement`, `browser-validate`, and
`commit-signed-pr`. Bundle-local symlinks resolve to those canonical files, and
the invariant suite compares their contents byte-for-byte. The human-facing
issue skills compose those files and retain single-agent behavior. Implementer
filters select phase craft, while policies deny ORCHESTRATION-classified skills
by bare and namespaced frontmatter name and deny agent-creation tools. The
workflow instructs the orchestrator to add a position/authority header, but no
policy validates that text. `.polly/workflow-state.md` records chronological
transitions, but unrestricted workers can rewrite it, so it is not an integrity
boundary.

Set the top-level orchestrator's host-skill filter to `none`, block the bare and
`polly-loopworks:` names of both human issue composers, and deny native or
custom child creation. Keep its own bundle-local `orchestrate-issue-pr` route
available and preserve `sys_session_send` for the declared worker roster; those
are the sequence and dispatch authorities the orchestrator must retain.

Limit the managed bundle to one draft pull request. Supporting dependent layers
would require per-layer and assembled-diff review, validation, publication, and
provenance mapping not represented by this sequence.

Every PR body and handoff records the actual author and reviewer models and
providers and whether either reviewer shared the author's model lineage. This
replaces categorical independence stamps that can misdescribe a real run.

Follow the root `AGENTS.md` reconciliation loop without a separate round cap.
One assessment is one reviewer's examination of one diff state; one
reconciliation round is the author's disposition or revision followed by both
original reviewers' assessments. Divergence means a contradiction on the same
finding: one reviewer keeps it blocking while the other explicitly holds that
same finding non-blocking or invalid. Different findings from disjoint scopes
are not divergence. For a same-finding contradiction, author dispute, or
undisposed finding, the orchestrator must stop dispatching and report the finding
and both positions to the human operator in normal output. Publication remains blocked
pending the recorded decision. If both reviewers share the author's
model lineage, explicit operator authorization is also required. The ignored
`.polly/` ledger and final reviewer packets are transient scratch; phase nine
publishes them as one labeled PR comment and records the comment URL before
handoff.

## Consequences

- Routing mistakes become roster/config changes instead of ad hoc model names.
- Reviewer mutation controls are defense in depth, not guaranteed containment;
  codex-native policy-hook degradation can disable them and fail open.
- Reviewers cannot run tests through shell; the review packet must contain all
  needed diff and test evidence.
- Gemini capacity is unavailable until its native harness gains a binding
  policy path.
- Automatic creation of a sibling worktree after the orchestrator starts is
  unsupported; the operator must launch from the prepared issue worktree.
- Managed dependent pull-request layers remain outside this workflow.
- The pinned external policy-source revision becomes a CI validation input and
  must be updated deliberately when the runtime changes.

## Validation

- `bun vitest run tests/unit/agent/polly-loopworks-spec.test.ts --reporter=verbose`
  exercises static invariants for roster, exact models, configured reviewer
  sandbox, policy configuration, phase skills, dispatch instructions, and the
  ledger contract. Behavioral policy probes are skipped unless
  `OMNIGENT_SOURCE_ROOT` points to the pinned revision; CI supplies that source
  before the test command.
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
