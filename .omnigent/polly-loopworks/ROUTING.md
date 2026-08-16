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
there is no Gemini worker in the roster. A human, not an unconfined model,
settles a disagreement the two configured reviewers cannot resolve.

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

## Binding controls

### Reviewers

Both reviewer configs:

- disable bypass modes (`yolo: false` or Claude `permission_mode: plan`);
- use an explicit Seatbelt sandbox with no workspace write path;
- apply the public `read_only_os` policy to direct edit tools;
- deny every native and Omnigent shell tool through CEL; and
- retain `blast_radius` with `gate_pushes: true` as defense in depth.

The `.polly` hidden directory is readable so reviewers can consume the packet,
but it remains non-writable. Reviewers receive no skills and policies block the
human-facing orchestration skills plus native agent-spawn tool names.

### Implementers

Omnigent makes the runner launch workspace authoritative for every child. Its
current dispatch schema has no per-child cwd, and a worker's configured cwd is
overridden by the runner workspace. Consequently no bundle setting can move a
worker from the main checkout into a sibling issue worktree.

The managed workflow therefore requires the bundle itself to be launched from
the intended sibling worktree and stops before dispatch when effective cwd does
not match. This is an explicit operational precondition, not a filesystem
containment claim. Implementers remain trusted writers inside that launch
workspace.

Implementers use `gate_pushes: false` so authorized publication can run without
an approval deadlock. A separate CEL policy denies `gh pr merge` regardless of
that setting. The orchestrator uses `gate_pushes: true` and the same merge deny.

### Nested agents and skills

Implementers discover only `tdd-implement`, `browser-validate`, and
`commit-signed-pr`; reviewers discover no skills. Every worker also carries:

- public `block_skills` denial for `implement-issue` and
  `implement-issue-pr`; and
- CEL denial for native and Omnigent agent-creation tool names.

The human-facing issue skills explain managed mode, while the three worker
skills contain craft only. Sequence, reviewer dispatch, and authority remain in
the bundle-local orchestrator skill.

## Review and provenance record

Every issue change receives fresh `reviewer_sol` and `reviewer_opus` sessions
in the same dispatch turn. Each sees only the issue, acceptance criteria, test
plan, and diff by file path and never sees the other's findings. The authoring
worker disposes findings; both reviewers assess the final diff.

Every PR body and handoff records:

- author model and provider;
- Reviewer A model and provider;
- Reviewer B model and provider; and
- whether either reviewer shared the author's model lineage.

This factual record is required on every run, including fallbacks. There is no
categorical stamp that can imply a model or provider different from the one
that actually reviewed.

## Workflow scope

The managed bundle supports one draft pull request per issue. Dependent
pull-request layers are outside this skill because they require layer-specific
review, validation, publication, and assembled-diff evidence that this sequence
does not map.

All dispatches begin with the fixed role/position/authority header in the
bundle skill. `.polly/workflow-state.md` is append-only across transitions and
orients resumed sessions. Validation gates run serially. The contributor-bound
worker performs preflight, signed commit, push, draft PR publication, and
GitHub provenance. No actor marks ready or merges.
