# Polly LoopWorks Routing Contract

This bundle provides a model-pinned roster and routing guidance. It does not
provide the managed issue-to-PR workflow previously proposed for PR #268. That
work is tracked by [issue #280](https://github.com/ncolesummers/loopworks/issues/280).

## Roster

| Role | Model | Routing use |
| --- | --- | --- |
| `sol` | `gpt-5.6-sol` | Default substantive implementation |
| `luna` | `gpt-5.6-luna` | Mechanical and volume work |
| `terra` | `gpt-5.6-terra` | Mid-tier implementation and spill |
| `opus` | `claude-opus-5` | Architecture, ambiguity, and cross-provider spill |
| `reviewer_sol` | `gpt-5.6-sol` | Correctness and test-adequacy review |
| `reviewer_opus` | `claude-opus-5` | Architecture and blast-radius review |

No worker pins `claude-fable-5`. The executing CEL probe demonstrates that a
direct `sys_session_send` override to Fable is denied, an ordinary declared
model override is allowed, and `sys_session_create` is denied. The unrestricted
orchestrator shell remains outside those event branches, so this safeguard is
not general process containment.

## Reviewer restrictions

Both reviewer configs request the macOS `darwin_seatbelt` sandbox with no
workspace write grants, configure `read_only_os`, deny named shell and edit
tools, and gate pushes. `reviewer_opus` disables Claude's bypass mode with
`permission_mode: plan`; `reviewer_sol` sets `yolo: false`.

The policy hook for every codex-native worker can fail open when the Codex app
server is too old or workspace trust is rejected. This affects the implementers
`sol`, `luna`, and `terra`, plus `reviewer_sol`. Omnigent reports
`policy_hook_disabled_reason`, but this bundle has no executable preflight that
consumes it. In that state the named policy checks do not bind. A Linux reviewer
also needs a separately verified `linux_bwrap` configuration; this bundle does
not silently substitute an empty sandbox.

## Skill policy

`.claude-plugin/plugin.json` is the single repo-owned policy manifest read as
the bundle's Claude plugin manifest and by CI. It fixes the shared plugin name
as `polly-loopworks`, records every resolved project and bundle skill as CRAFT
or ORCHESTRATION, and carries an explicit reviewed blocklist. Classification is
not stored in `SKILL.md`, so upstream reinstalls of `agent-browser`, `eve`, or
`gh-stack` do not erase local policy.

CI separately pins the expected classification map. A classification edit
therefore fails as a policy change; the expected blocklist is not recomputed
from the edited classification. Discovery fails on an unclassified skill, a
duplicate resolved name, or a basename/frontmatter-name mismatch.

Every checked-in `block_skills` policy uses the manifest's explicit blocklist:
the two human composers by bare name, plus `orchestrate-issue-pr` in both its
bare form and its real resolver-derived bundle form,
`polly-loopworks:orchestrate-issue-pr`. CRAFT names are absent. The runtime
probe installs a copy of this bundle through the pinned Omnigent Claude plugin
resolver and executes the resulting qualified `Skill` calls against every
blocklist.

Named native and Omnigent agent-creation tools are also denied. This is defense
in depth only: the orchestrator and implementing workers have unrestricted
shells, and can construct other client invocations. The roster and prompt are
routing guidance, not an enforceable dispatch allowlist.

## Filesystem and repository boundaries

No tested bundle mechanism confines or relocates an implementing worker to a
sibling worktree. The orchestrator's cwd check is self-attested, its shell has
`allow_cwd_override: true`, and implementers use `sandbox: none` with
`gate_pushes: false` for publication capability. A mistaken launch can expose
the main checkout or permit ungated pushes.

The merge CEL expression covers common `gh pr merge`, REST merge, and GraphQL
`mergePullRequest` forms through both `Bash` and `sys_os_shell`. It is a
best-effort speed bump, not containment: command construction and other clients
can bypass string matching. The durable controls are branch protection or a
token without merge scope; provisioning them is out of scope.

## Deferred workflow conventions

Dispatch headers, a chronological `.polly/workflow-state.md`, separate review
artifacts, and worktree bootstrap are conventions under consideration in
[issue #280](https://github.com/ncolesummers/loopworks/issues/280); they are not
enforced by PR #268. Useful bootstrap guidance remains: run
`bun install` when `node_modules` is absent, copy required `.env.local` values
without printing secrets, and keep worktrees outside ignored in-repository
paths so `security:osv` can discover package sources. No dispatched worker is
guaranteed to receive or complete those steps.

The ignored `.polly/` directory is transient scratch, not an integrity or
publication boundary. Review isolation, reconciliation and termination,
orchestrator containment, dispatch validation, ledger guarantees, bootstrap
gating, and publication sequencing remain entirely in
[issue #280](https://github.com/ncolesummers/loopworks/issues/280).
