# Set up Omnigent and run the orchestrated issue workflow

How to install the prerequisites, create a worktree, launch the
`.omnigent/polly-loopworks/` bundle, and drive an issue through it. Written from
an actual run of issue #267; every troubleshooting entry below is a failure that
really happened.

This page deliberately mixes Diátaxis modes — how-to, reference, explanation,
and a first run — because it is meant to be read end to end before you launch
the orchestrator for the first time. That is a recorded exception, not an
accident; see [#281](https://github.com/ncolesummers/loopworks/issues/281).

> **What the bundle is.** `.omnigent/polly-loopworks/` is a **routing-only**
> bundle: a model-pinned roster of six workers plus routing guidance. It does
> **not** implement a managed issue-to-PR workflow. Review isolation,
> arbitration, reconciliation and termination, orchestrator containment,
> dispatch envelopes, ledger integrity, bootstrap gating, phase ownership, and
> publication sequencing are deferred to
> [issue #280](https://github.com/ncolesummers/loopworks/issues/280). The
> sequence in section 4 is a convention **you** run. Nothing in the bundle
> enforces it. See `.omnigent/polly-loopworks/ROUTING.md` and
> [ADR 0034](../adr/0034-project-scoped-polly-model-routing.md).
>
> **Platform.** macOS only today. Both reviewer configs request the
> `darwin_seatbelt` sandbox with no write paths. A Linux reviewer needs a
> separately verified `linux_bwrap` configuration; the bundle does not
> substitute an empty sandbox when one is missing, so Linux is unsupported
> rather than quietly unsafe.

## 1. Prerequisites

| Requirement | Check | Notes |
| --- | --- | --- |
| Claude Code CLI | `command -v claude` | required — `opus` and `reviewer_opus` use `harness: claude-native` |
| Codex CLI | `command -v codex` | required — `sol`, `luna`, `terra`, and `reviewer_sol` use `harness: codex-native` |
| GitHub CLI, authenticated | `gh auth status` | needed for issues, PRs, provenance |
| `GH_TOKEN` exported | `echo ${GH_TOKEN:+set}` | see below — this bites every time |
| Bun | `bun --version` | all repo gates |

Delegated workers do **not** inherit your macOS Keychain, so `gh` inside a worker
reports an invalid token even though it works in your terminal. Put this in your
shell profile:

```sh
export GH_TOKEN="$(gh auth token)"
```

The roster is exactly six workers across those two harnesses — there are no
optional extra CLIs to install and no additional vendors to configure. Because
`reviewer_sol` is codex-native and `reviewer_opus` is claude-native, you need
**both** CLIs to run cross-vendor review at all.

The orchestrator prompt instructs it to run `command -v codex claude || true` as
a routing preflight and to report any unavailable harness. That is prompt
guidance, not an executable check: the bundle ships no preflight script, and
nothing fails closed if a harness is missing.

## 2. Create the worktree — the rule that costs the most when missed

**Worktrees must live OUTSIDE the repository.**

```sh
git worktree add ../loopworks-worktrees/<issue#>-<slug> -b feat/<issue#>-<slug>
cd ../loopworks-worktrees/<issue#>-<slug>
bun install          # a fresh worktree has no node_modules
# copy any env file the change needs from the main checkout
```

Why it matters: paths inside the repo (`.claude/worktrees/…`) are gitignored, and
`security:osv` honours gitignore. Run from an in-repo worktree and `validate` fails
with **"No package sources found"** — so no commit can ever pass, and the error
points nowhere near the real cause.

Do this bootstrap yourself, before you launch. `ROUTING.md` records it as useful
guidance and states plainly that no dispatched worker is guaranteed to receive or
complete those steps.

## 3. Launch the orchestrator

**Launch with your cwd set to the worktree from step 2.** The orchestrator and
every worker declare `os_env.cwd: .`, so each one inherits the launching
session's working directory. Nothing in the bundle re-anchors a worker to a
different directory, and nothing verifies where you launched from — see
[Known gaps](#5-known-gaps--read-before-you-trust-the-guardrails).

Point the launcher at:

```text
.omnigent/polly-loopworks/
```

### 3.1 CRAFT and ORCHESTRATION skills

A worker can load `tdd-implement` but not `orchestrate-issue-pr`, and the reason
is a policy classification rather than anything in the skills themselves.

Classification lives in the repo-owned
`.omnigent/polly-loopworks/.claude-plugin/plugin.json`, under
`metadata.loopworks.skillClassifications` — never in skill frontmatter. That
placement is deliberate: reinstalling a vendored upstream skill such as
`agent-browser`, `eve`, or `gh-stack` cannot erase the repo's policy.

| Class | Skills |
| --- | --- |
| CRAFT | `agent-browser`, `browser-validate`, `commit-signed-pr`, `eve`, `gh-stack`, `tdd-implement`, and the bundle-qualified `polly-loopworks:browser-validate`, `polly-loopworks:commit-signed-pr`, `polly-loopworks:tdd-implement` |
| ORCHESTRATION | `implement-issue`, `implement-issue-pr`, `orchestrate-issue-pr`, `polly-loopworks:orchestrate-issue-pr` |

The manifest's `orchestrationBlocklist` is exactly those four ORCHESTRATION
names, and every actor — the orchestrator and all six workers — carries that
same list in its `block_orchestration_skills` policy. CRAFT names appear in no
blocklist. Each implementer declares `skills: [tdd-implement, browser-validate,
commit-signed-pr]`; both reviewers declare `skills: none`.

The reserved name is blocked in both forms — bare `orchestrate-issue-pr` and the
resolver-derived `polly-loopworks:orchestrate-issue-pr` — because a Claude worker
resolves bundle skills under the shared plugin namespace and would otherwise
reach it by its qualified name.

Why the split matters: an ORCHESTRATION skill runs a whole issue-to-PR workflow,
including its own review and publication. A worker that loaded one would review
and publish its own work. CRAFT skills do a bounded piece of work and return.

Treat a classification edit as a policy change. CI pins the expected
classification map independently, so an edit fails rather than silently
recomputing a smaller blocklist, and discovery fails on an unclassified skill, a
duplicate resolved name, or a basename/frontmatter-name mismatch.

Two limits worth knowing: the block binds **named skill loads only** — every
implementer keeps an unrestricted shell and can still read a blocked skill's file
— and on codex-native workers the whole policy hook can fail open (see section
5).

## 4. What you do, and what the agents do

The bundle does not own or enforce any of this. It makes no guarantee about
phase ownership; the table below is the convention you drive by hand, with the
roster supplying the routing.

| Phase | Owner |
| --- | --- |
| 0 intake, PR shape | orchestrator |
| 1 worktree verification | orchestrator (self-attested — see section 5) |
| 2 issue + acceptance-criteria extraction | orchestrator |
| 3-4 test plan, then TDD red -> green | implementer (one session — do not split) |
| 5 browser validation | implementer |
| 6 dual adversarial review | `reviewer_sol` and `reviewer_opus`, different providers, in parallel |
| 7 validation gates | orchestrator, **serially** |
| 8 signed commit + draft PR | implementer |
| 9 evidence + handoff | orchestrator |
| 10 merge | **you** |

Your three jobs:

1. **Approve the plan** before implementation starts.
2. **Arbitrate** a disagreement that survives one reconciliation round. There is
   no tiebreak seat in the roster and no automated arbitration — see Known gaps.
3. **Merge.** No agent should merge, and the merge block is best-effort only.

You must assemble what the reviewers see. Give each reviewer the diff and the
acceptance contract as files rather than a pointer to the implementer's
worktree — but understand that this is your discipline, not a property of the
bundle. Both reviewer prompts say so explicitly: *"Do not assume packet
isolation."* Reviewers do have real mutation controls: `darwin_seatbelt` with no
write paths, `read_only_os`, denial of named shell and edit tools, gated pushes,
`permission_mode: plan` on `reviewer_opus`, and `yolo: false` on `reviewer_sol`.

Every CLI worker runs in a real terminal, so you can watch one or take it over
from the Subagents panel.

## 5. Known gaps — read before you trust the guardrails

These are recorded honestly rather than papered over. The project's rule is that a
guard which lies is worse than an absent guard.

- **No Gemini worker, and no tiebreak seat.** The Gemini worker was removed
  outright: the available Antigravity native executor binds neither the worker
  prompt, nor a policy hook, nor a read-only sandbox — it discards
  `system_prompt` and launches unsandboxed regardless of what the spec says. The
  roster therefore has no third-model seat to break a tie, so a reviewer
  disagreement that survives reconciliation escalates to **you**.
- **No worktree confinement — deleted, not partial.** No checked-in mechanism
  confines or relocates a worker to a sibling worktree. Every implementer runs
  `cwd: .` with `sandbox: none` and `gate_pushes: false`; the orchestrator's own
  cwd check is self-attested, and its terminal keeps `allow_cwd_override: true`.
  A runner-supplied workspace override (`OMNIGENT_RUNNER_WORKSPACE` in the
  build used for the #267 run) supersedes the configured cwd, which is why the
  earlier guard was removed as unenforceable rather than kept as a partial one.
  Launching from the correct worktree is an *operational precondition you must
  satisfy*: a mistaken launch can expose the main checkout or permit ungated
  pushes.
- **Merge denial is best-effort only.** The CEL expression matches common
  `gh pr merge`, REST `/merge`, and GraphQL `mergePullRequest` forms through both
  `Bash` and `sys_os_shell`. It is a speed bump, not containment — command
  construction and other clients bypass string matching. The durable controls are
  GitHub branch protection or a worker token without merge scope, and
  provisioning them is out of scope for this bundle.
- **The codex policy hook can fail open.** If the Codex app server is too old or
  workspace trust is rejected, the named merge, agent, skill, write, and shell
  policies do not bind for `sol`, `luna`, `terra`, or `reviewer_sol`. Omnigent
  reports `policy_hook_disabled_reason`, but the bundle ships no executable
  preflight that consumes it, so nothing warns you.
- **The orchestrator is not contained.** It keeps an unrestricted shell and can
  launch clients outside the named agent tools. Denying nested-agent tools and
  custom session creation is defense in depth; the roster and prompt are routing
  guidance, not an enforceable dispatch allowlist.
- **Arbitration, review-packet isolation, and orchestrator containment are
  absent, not partial.** They are deferred to
  [issue #280](https://github.com/ncolesummers/loopworks/issues/280), along with
  reconciliation and termination, dispatch-envelope validation, ledger integrity,
  bootstrap gating, and publication sequencing. Dispatch headers, a
  `.polly/workflow-state.md` ledger, and separate review artifacts are
  conventions under consideration — not mechanisms that exist today.

## 6. Troubleshooting — real failures from the #267 run

**The bundle does not appear in the agent picker.** The picker lists single
`*.yaml` agent configs; this bundle is a *directory* (`agents/`, `skills/`,
`.claude-plugin/`). It launches fine by path. That is expected, not a broken
install.

**A worker deleted my `.polly/` files.** `.polly/` is gitignored (`.gitignore`)
and excluded from markdownlint (`.markdownlint-cli2.yaml`), and read-only workers
treat untracked files as scratch. Reviewer sandboxes explicitly allow it via
`cwd_allow_hidden`, but nothing stops an implementer from sweeping it, so say so
in the dispatch. Separately: `.polly/` is transient scratch, not an integrity or
publication boundary — never treat a local ledger there as verified state.

**A worker spawned its own reviewers.** Repo skills are discovered by walking up
from cwd, so a worker in this checkout finds skills written for a single
all-powerful agent. Every actor's `block_orchestration_skills` policy denies the
four ORCHESTRATION names, but there is no dispatch header mechanism to tell a
worker that review is owned upstream — put that in your own dispatch text. If you
see nested review, check whether the blocklist has drifted from the skill set.

**"already has a launching or running turn."** You cannot inject new information
into a worker mid-pass. Wait for the turn to end and send it again — nothing makes
a running worker re-read a file you changed underneath it.

**A multi-line prompt vanished in a TUI worker.** Write the content to a file and
send a one-line prompt pointing at the path.

**Two ADRs with the same number.** `main` moving can land an ADR at the number your
branch used. Git will not warn you — the filenames differ, so both merge cleanly.
Check `docs/adr/` after every rebase.

**Playwright failing for no reason.** Two `validate` runs at once starve an M1 and
produce fake e2e failures. Run gates serially and re-run a spec alone before
believing it.
