# Polly LoopWorks Routing and Enforcement

This is the public contract for the repository-scoped `polly-loopworks` bundle.
Worker names encode routing tiers; the orchestrator selects a role instead of
remembering a model string.

## Supported runtime

The bundle currently targets the LoopWorks macOS host. Reviewer configs set
`sandbox.type: darwin_seatbelt` explicitly and therefore fail loudly on Linux
instead of selecting an unavailable sandbox or silently running without one.
A Linux deployment needs separate reviewer specs with an explicit
`linux_bwrap` backend and verified `bwrap` installation.

The Antigravity native harness has no policy-enforcement path for this bundle:
it discards the worker prompt and launches without a binding sandbox. Therefore
there is no Gemini worker in the roster. Phase six stops after two
reconciliation rounds and asks the human operator to settle unresolved or
disputed findings.

## Routing tiers

| Worker | Model | Use |
| --- | --- | --- |
| `sol` | `gpt-5.6-sol` | Default substantive implementation |
| `luna` | `gpt-5.6-luna` | Mechanical and volume work |
| `terra` | `gpt-5.6-terra` | Work beyond Luna that does not need Sol |
| `opus` | `claude-opus-5` | Architecture, ambiguity, escalation, provider spill |
| `reviewer_sol` | `gpt-5.6-sol` | Correctness, edge cases, test adequacy |
| `reviewer_opus` | `claude-opus-5` | Architecture, blast radius, coupling |

No worker pins `claude-fable-5`. A CEL policy denies a dispatch-time Fable
override and custom child creation. Changing that requires an explicit policy
edit.

## Runtime controls and known gaps

### Reviewers

Both reviewer configs attempt defense in depth by:

- disabling bypass modes (`yolo: false` or Claude `permission_mode: plan`);
- using an explicit Seatbelt sandbox with no workspace write path;
- configuring the public `read_only_os` policy for direct edit tools;
- configuring CEL rejection for native and Omnigent shell tools; and
- retain `blast_radius` with `gate_pushes: true` as defense in depth.

The `.polly` hidden directory is readable so reviewers can consume the packet,
but it remains non-writable when the configured sandbox binds. Reviewers receive
no bundle skills; `block_skills` is derived from every project-discoverable
`.agents/skills/*` name, and CEL targets native agent-spawn tool names.

These policies are not a containment boundary for `reviewer_sol`. The
codex-native executor can fail open when the Codex app-server is too old or
workspace trust is rejected. Omnigent exposes `policy_hook_disabled_reason`
once, but this bundle has no executable preflight that consumes it. In that
state `read_only_os`, shell denial, nested-agent denial, and skill blocking do
not bind. The Codex reviewer remains for routing capacity with this residual
risk recorded; operators must not infer enforcement merely from the YAML.

### Implementers

No checked-in probe demonstrates a binding per-worker relocation or confinement
mechanism. The managed workflow therefore requires the bundle itself to be
launched from the intended sibling worktree and instructs the orchestrator to
stop before dispatch when effective cwd does not match. This self-attested
operational precondition is not filesystem containment. Implementers remain
trusted writers inside the launch workspace.

Implementers use `gate_pushes: false` so authorized publication can run without
an approval deadlock. A CEL command-pattern policy covers direct `gh pr merge`,
repository-qualified `gh -R`/`gh --repo` forms, and `gh api` merge endpoints.
It is a best-effort speed bump, not containment: command strings can be
constructed indirectly, and other clients can call the API. The durable control
is GitHub branch protection or a worker token without merge scope. Provisioning
either durable control is out of scope for this PR, so merge prevention remains
a recorded gap. The orchestrator uses `gate_pushes: true` and the same speed
bump.

### Nested agents and skills

The bundle injects only `tdd-implement`, `browser-validate`, and
`commit-signed-pr` into implementers; reviewers receive no bundle skills. Every
worker also configures:

- public `block_skills` denial derived from all project-discoverable skills; and
- CEL denial for native and Omnigent agent-creation tool names.

The human-facing issue skills explain managed mode. Bundle-local symlinks point
to the three canonical worker craft files, and the invariant suite compares the
resolved contents byte-for-byte. Sequence, reviewer dispatch, and authority
remain in the bundle-local `orchestrate-issue-pr` skill.

## Review and provenance record

Every issue change receives fresh `reviewer_sol` and `reviewer_opus` sessions
in the same dispatch turn. Each sees only the issue, acceptance criteria, test
plan, and diff by file path and never sees the other's findings. The authoring
worker disposes findings; both reviewers assess the final diff. Reconciliation
stops after two reconciliation rounds. Undisposed or disputed findings and
reviewer divergence block publication until the human operator records a
decision and both original reviewers assess the resulting final diff.

Every PR body and handoff records:

- author model and provider;
- Reviewer A model and provider;
- Reviewer B model and provider; and
- whether either reviewer shared the author's model lineage.

This factual record is required on every run, including fallbacks. There is no
categorical stamp that can imply a model or provider different from the one
that actually reviewed.

Fallback uses only declared reviewer configs. If both reviewers share the
author's model lineage, publication remains blocked without explicit operator
authorization for the degraded topology.

## Workflow scope

The managed bundle supports one draft pull request per issue. Dependent
pull-request layers are outside this skill because they require layer-specific
review, validation, publication, and assembled-diff evidence that this sequence
does not map.

All dispatches begin with the fixed role/position/authority header in the
bundle skill. `.polly/workflow-state.md` is append-only across transitions and
orients resumed sessions, but the ignored `.polly/` directory is transient.
Phase nine publishes the ledger and both final reviewer packets in one labeled
PR comment and records its URL. Validation gates run serially. The
contributor-bound worker performs preflight, signed commit, push, draft PR
publication, and GitHub provenance. No actor marks ready or merges.
