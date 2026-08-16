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
there is no Gemini worker in the roster. Phase six follows the root `AGENTS.md`
reconciliation loop and reports unresolved or disputed findings to the human
operator in normal output.

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
but it remains non-writable when the configured sandbox binds. `skills: none`
suppresses host skills but not bundle skills. The skill policy therefore denies
each ORCHESTRATION-classified skill by its parsed frontmatter name in both bare
and `<agent>:<skill>` forms; it does not deny CRAFT-classified skills. CEL
targets native agent-spawn tool names.

These policies are not a containment boundary for every codex-native worker:
the implementers `sol`, `luna`, and `terra`, plus `reviewer_sol`. Their policy
hook can fail open when the Codex app-server is too old or workspace trust is
rejected. Omnigent exposes `policy_hook_disabled_reason` once, but this bundle
has no executable preflight that consumes it. In that state merge, nested-agent,
and skill policies do not bind for the implementers; direct-write, shell,
nested-agent, and skill policies do not bind for `reviewer_sol`. These workers
remain for routing capacity with this residual risk recorded; operators must
not infer enforcement merely from the YAML.

### Implementers

No checked-in probe demonstrates a binding per-worker relocation or confinement
mechanism. The managed workflow therefore requires the bundle itself to be
launched from the intended sibling worktree and instructs the orchestrator to
stop before dispatch when effective cwd does not match. This self-attested
operational precondition is not filesystem containment. Implementers remain
trusted writers inside the launch workspace.

Implementers use `gate_pushes: false` so authorized publication can run without
an approval deadlock. A CEL command-pattern policy recognizes several common
layouts: repository flags before or after `pr`, compact `-R`, REST merge
endpoints, and GraphQL `mergePullRequest` mutations. It does not enumerate every
valid CLI or API spelling. This is a best-effort speed bump, not containment:
command strings can be constructed indirectly, and other clients can call the
API. The durable control is GitHub branch protection or a worker token without
merge scope. Provisioning either durable control is out of scope for this PR,
so merge prevention remains a recorded gap. The orchestrator uses
`gate_pushes: true` and the same speed bump.

### Nested agents and skills

Implementer filters select `tdd-implement`, `browser-validate`, and
`commit-signed-pr`; reviewer filters suppress host skills. Bundle skills remain
discoverable in Claude-native sessions regardless of the filter, so every
worker also configures:

- public `block_skills` denial of only ORCHESTRATION-classified frontmatter
  names, including each worker's namespaced form; and
- CEL denial for native and Omnigent agent-creation tool names.

The human-facing issue skills explain managed mode. Bundle-local symlinks point
to the three canonical worker craft files, and the invariant suite compares the
resolved contents byte-for-byte. Sequence, reviewer dispatch, and authority
remain in the bundle-local `orchestrate-issue-pr` skill.

The top-level orchestrator uses `skills: none` to suppress host skills and
blocks the bare and `polly-loopworks:` names of both human issue composers. Its
own bundle-local `orchestrate-issue-pr` route remains available because that is
the sequence it is authorized to run. A separate CEL policy denies native and
custom child creation while preserving `sys_session_send` to the declared
worker roster.

## Review and provenance record

Every issue change receives fresh `reviewer_sol` and `reviewer_opus` sessions
in the same dispatch turn. Each sees only the issue, acceptance criteria, test
plan, and diff by file path and never sees the other's findings. The authoring
worker disposes findings; both reviewers assess the final diff. One assessment
is one reviewer's examination of one diff state; one reconciliation round is
the author's disposition or revision followed by both original reviewers'
assessments. Reconciliation follows the root `AGENTS.md` without a separate
round cap. Divergence means a contradiction on the same finding: one reviewer
keeps it blocking while the other explicitly holds that same finding
non-blocking or invalid. Different findings from disjoint scopes are not
divergence. For a same-finding contradiction, author dispute, or undisposed
finding, the orchestrator must stop dispatching and report the finding and both
positions to the human operator in normal output. Publication remains blocked
pending the recorded human decision.

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

The workflow instructs the orchestrator to prefix dispatches with the fixed
role/position/authority header in the bundle skill; no policy validates that
text. `.polly/workflow-state.md` records chronological transitions and orients
resumed sessions, but unrestricted workers can rewrite it, so it is not an
integrity boundary. The ignored `.polly/` directory is transient. Phase nine
publishes the ledger and both final reviewer packets in one labeled PR comment
and records its URL. Validation gates run serially. The contributor-bound worker
performs preflight, signed commit, push, draft PR publication, and GitHub
provenance. No actor marks ready or merges.
