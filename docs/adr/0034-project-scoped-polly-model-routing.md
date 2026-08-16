# ADR 0034: Project-Scoped Polly Routing With Explicit Enforcement Boundaries

Status: Proposed
Date: 2026-08-15
Issue: [#267 — Project-scoped Polly orchestrator with subscription-aware model routing](https://github.com/ncolesummers/loopworks/issues/267)

## Context

LoopWorks delegates coding work across separately metered OpenAI and Anthropic
subscriptions. Generic vendor-named workers leave model tier and task routing to
prompt-time judgment. Earlier revisions of PR #268 also specified a managed
issue-to-PR workflow, but three review rounds established that its review,
containment, ledger, and dispatch guarantees were not implemented.

## Decision

Add `.omnigent/polly-loopworks/` as a routing-only bundle with six role-named,
model-pinned workers:

- `sol`, `luna`, `terra`, and `opus` are implementation roles; and
- `reviewer_sol` and `reviewer_opus` are review roles.

Do not register a Gemini worker. The available Antigravity native executor does
not bind the worker prompt, policy hook, or read-only sandbox. No worker pins
`claude-fable-5`; an executing CEL probe verifies that a direct Fable model
override is denied, a declared-model send is allowed, and custom session
creation is denied.

Target the current bundle at the LoopWorks macOS host. Reviewer configs request
`darwin_seatbelt` with no workspace write grants, disable harness bypass modes,
and configure named direct-edit and shell rejection. A Linux deployment needs a
separate explicit `linux_bwrap` configuration and verified runtime support.

Use only public policy handlers under `omnigent.policies.builtins.*`. CI imports
every configured handler from a pinned Omnigent source revision. Function-policy
`on:` fields are ignored at that revision, so the configs omit them and let each
handler select its supported event shape.

The policy hook for every codex-native worker can fail open when the Codex app
server is too old or workspace trust is rejected. This affects the implementers
`sol`, `luna`, and `terra`, plus `reviewer_sol`. Omnigent reports
`policy_hook_disabled_reason` once, but this bundle has no executable preflight
that consumes it. In that degraded state the named merge, agent, skill, write,
and shell policies do not bind. Keep those roles for routing capacity while
recording that the YAML is not a complete containment boundary.

Store skill classification in the repo-owned
`.omnigent/polly-loopworks/.claude-plugin/plugin.json`, not in skill
frontmatter. Omnigent preserves that existing plugin manifest, so every Claude
worker resolves bundle skills under the shared `polly-loopworks:` namespace.
The same manifest records every resolved project and bundle skill as CRAFT or
ORCHESTRATION and carries an explicit reviewed orchestration blocklist.

CI pins the expected classification map independently. A classification edit
therefore fails with "classification changed - this is a policy change" instead
of recomputing a smaller expected blocklist. An unclassified skill, duplicate
resolved name, or basename/frontmatter-name mismatch fails CI. This avoids
modifying vendored `agent-browser`, `eve`, and `gh-stack` frontmatter, so an
upstream reinstall cannot erase the repo's classification.

Every actor uses the same explicit blocklist. It contains the human issue
composers by bare name and the reserved bundle workflow skill as both
`orchestrate-issue-pr` and its actual resolver-derived name,
`polly-loopworks:orchestrate-issue-pr`. The executing policy probe asks the
pinned Omnigent Claude resolver for qualified skill names and evaluates those
real `Skill` calls. CRAFT skills remain outside the blocklist.

Named native and Omnigent agent-creation tools are denied as defense in depth.
Do not describe that as orchestrator containment: the orchestrator and
implementers retain unrestricted shells and can invoke other clients. The
checked-in roster is routing guidance, not a shell-level dispatch allowlist.

Do not claim filesystem confinement for implementers. No checked-in mechanism
relocates or confines a child to a sibling worktree. Any cwd check is
self-attested by an unsandboxed orchestrator whose terminal retains
`allow_cwd_override: true`. Implementers use `sandbox: none` and
`gate_pushes: false`; a mistaken launch can therefore expose the main checkout
or permit ungated pushes.

Treat the merge command pattern as a best-effort speed bump. Its executing probe
covers common CLI, REST, and GraphQL merge forms through both `Bash` and
`sys_os_shell`. Shell indirection and other clients can bypass string matching.
The durable control is branch protection or a token without merge scope; both
remain out of scope.

The workflow half is deferred to
[#280](https://github.com/ncolesummers/loopworks/issues/280). PR #268 makes no
guarantee about review isolation, arbitration, reconciliation termination,
orchestrator containment, dispatch-envelope delivery, ledger integrity,
bootstrap gating, phase ownership, or publication sequencing. Dispatch headers,
ledger entries, and bootstrap steps may be useful conventions, but are not
enforced by this routing bundle.

## Consequences

- Routing mistakes become explicit roster or manifest changes instead of ad hoc
  model-name choices.
- Reviewer mutation controls are defense in depth and can fail open on the
  documented codex-native degradation path.
- CRAFT / ORCHESTRATION policy survives third-party skill reinstalls and fails
  closed on new or ambiguously named skills.
- The real Claude bundle namespace is covered by every blocklist and exercised
  through the pinned resolver.
- Workflow behavior and its security properties cannot be claimed until #280
  supplies and tests them.

## Validation

- `bun vitest run tests/unit/agent/polly-loopworks-spec.test.ts --reporter=verbose`
  checks the exact roster and models, manifest policy, unique skill identity,
  blocklists, reviewer configuration, and documented enforcement gaps.
- Runtime policy tests run only when `OMNIGENT_SOURCE_ROOT` points to the pinned
  source revision; without it those tests are explicitly skipped.
- The runtime probes execute merge denial through `Bash` and `sys_os_shell`,
  Fable denial, public handler imports, and resolver-derived qualified skill
  calls.
- `bun run validate` remains the aggregate repository gate and runs serially.

## Follow-ups

- Design and verify the managed workflow in
  [#280](https://github.com/ncolesummers/loopworks/issues/280).
- Add a Linux reviewer variant only after `linux_bwrap` startup and denial
  behavior are tested on the target host.
- Reconsider Gemini only when its native executor propagates prompts and policy
  decisions through an enforceable hook and sandbox.
- Replace the cwd convention when Omnigent provides a tested per-worker
  workspace boundary.
