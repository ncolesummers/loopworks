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
> bundle: a model-pinned roster of six workers plus routing guidance. Read
> "model-pinned" narrowly. Each worker declares a fixed model and none pins
> `claude-fable-5`, and the tested policy denies one specific override: a direct
> `sys_session_send` to Fable. An *ordinary declared model override is allowed*;
> `sys_session_create` is denied (`ROUTING.md`). The bundle does
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

That token gives a worker your GitHub scope, and `main` is protected against it
server-side, independently of anything in the bundle. Two **active** rulesets
cover the default branch, and **both have an empty bypass actor list** — an
empty list binds everyone, including the repository owner and admin tokens.
That is the opposite of classic branch protection, where admins are exempt
unless `enforce_admins` is set. A worker holding the token therefore cannot
force-push or rewrite `main` (`non_fast_forward`), delete it (`deletion`), push
directly to it around a pull request (`pull_request`), or merge with red or
missing CI (`required_status_checks`: `validate`, `seeded-postgres-e2e`,
`commit-provenance`).

One residual gap: `required_approving_review_count` is `0`, so a green PR can be
merged with no human approval. "The orchestrator never merges; you do" is a
convention, not a server-enforced control.

Operator note when you verify this yourself: the classic endpoint
`repos/OWNER/REPO/branches/main/protection` returns
`404 Branch not protected` on this repository. That is a **false negative** —
this repository uses rulesets, not classic branch protection. The correct probe
is `repos/OWNER/REPO/rulesets`.

The roster is exactly six workers across those two harnesses — there are no
optional extra CLIs to install and no additional vendors to configure. Because
`reviewer_sol` is codex-native and `reviewer_opus` is claude-native, you need
**both** CLIs to run cross-vendor review at all.

The orchestrator prompt instructs it to run `command -v codex claude || true` as
a routing preflight and to report any unavailable harness. That is prompt
guidance, not an executable check: the bundle ships no preflight script, and
nothing fails closed if a harness is missing.

## 2. Create the worktree — the rule that costs the most when missed

**Keep worktrees out of ignored in-repository paths.** A sibling directory is
the simplest way to satisfy that.

```sh
git worktree add ../loopworks-worktrees/<issue#>-<slug> -b feat/<issue#>-<slug>
cd ../loopworks-worktrees/<issue#>-<slug>
bun install          # a fresh worktree has no node_modules
# copy any env file the change needs from the main checkout
```

Why it matters: `ROUTING.md` asks you to keep worktrees outside **ignored**
in-repository paths so `security:osv` can discover package sources. The common
in-repo location, `.claude/worktrees/…`, is gitignored, and `security:osv`
honours gitignore. Run from there and `validate` fails with **"No package
sources found"** — so no commit can ever pass, and the error points nowhere near
the real cause. An in-repo worktree at a path that is *not* ignored is outside
what `ROUTING.md` warns about.

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

A worker can load `tdd-implement` but not `orchestrate-issue-pr`. The denial
does not come from the skills themselves, and it is not computed from the
classification map. It comes from an explicit `blocked:` list that every actor
carries in its own `block_orchestration_skills` policy — see
`agents/sol/config.yaml` and the identical stanza in the orchestrator's
`config.yaml` and in both reviewer configs.

The manifest holds two separate lists, and they are not the same length.

**The classification map** lives in the repo-owned
`.omnigent/polly-loopworks/.claude-plugin/plugin.json`, under
`metadata.loopworks.skillClassifications` — never in skill frontmatter. That
placement is deliberate: reinstalling a vendored upstream skill such as
`agent-browser`, `eve`, or `gh-stack` cannot erase the repo's policy. It has
twelve entries, three of them ORCHESTRATION:

| Class | Skills in the classification map |
| --- | --- |
| CRAFT | `agent-browser`, `browser-validate`, `commit-signed-pr`, `eve`, `gh-stack`, `tdd-implement`, and the bundle-qualified `polly-loopworks:browser-validate`, `polly-loopworks:commit-signed-pr`, `polly-loopworks:tdd-implement` |
| ORCHESTRATION | `implement-issue`, `implement-issue-pr`, `polly-loopworks:orchestrate-issue-pr` |

**The runtime blocklist** is the separate `orchestrationBlocklist` key in the
same manifest. It has **four** names: those three, plus bare
`orchestrate-issue-pr` — which the classification map does not contain at all.
That extra entry is the point. Because the blocklist is written out explicitly
rather than derived from the map, the reserved name is denied in both forms:
bare, and as the resolver-derived `polly-loopworks:orchestrate-issue-pr`. Both
are needed because a Claude worker resolves bundle skills under the shared
plugin namespace and would otherwise reach it by its qualified form.

Every actor — the orchestrator and all six workers — carries that same
four-name list in `block_orchestration_skills`, which routes to
`omnigent.policies.builtins.safety.block_skills`. CRAFT names appear in no
blocklist. Each implementer declares `skills: [tdd-implement, browser-validate,
commit-signed-pr]`; both reviewers declare `skills: none`.

Why the split matters, per skill:

- `implement-issue` and `implement-issue-pr` are real repo skills in
  `.agents/skills/`, and each runs a whole issue end to end — AC extraction,
  test-plan-first TDD, adversarial review, acceptance evidence; `-pr` also
  isolates a worktree, commits, and opens draft PRs. A worker that loaded one
  would review and publish its own work.
- The bundle's own `orchestrate-issue-pr` is **not** such a workflow. Its
  `SKILL.md` is a reserved placeholder that states PR #268 implements no
  issue-to-PR workflow and defers the contract to
  [issue #280](https://github.com/ncolesummers/loopworks/issues/280). It is
  blocklisted as a reserved name, not as a working workflow.

CRAFT skills do a bounded piece of work and return.

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
3. **Merge.** No agent should merge. A `deny_merge` policy is configured on the
   orchestrator and on the four implementers only, and it is best-effort. The
   two reviewer configs carry no `deny_merge` policy at all; they deny the named
   shell tools outright instead, so they have no shell to run `gh` from.

You must assemble what the reviewers see. Give each reviewer the diff and the
acceptance contract as files rather than a pointer to the implementer's
worktree — but understand that this is your discipline, not a property of the
bundle. Both reviewer prompts say so explicitly: *"Do not assume packet
isolation."* Reviewers do have real mutation controls: `darwin_seatbelt` with no
write paths, `read_only_os`, denial of named shell and edit tools, gated pushes,
`permission_mode: plan` on `reviewer_opus`, and `yolo: false` on `reviewer_sol`.

Only the orchestrator declares a terminal — `terminals.shell`, running `bash`,
in the bundle's `config.yaml`. No worker config declares one, and the bundle
defines no worker-takeover mechanism.

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
  The earlier guard was removed as unenforceable rather than kept as a partial
  one. Launching from the correct worktree is an *operational precondition you
  must satisfy*: a mistaken launch can expose the main checkout or permit
  ungated pushes.
- **Merge denial covers five of the seven actors, and is best-effort even
  there.** `deny_merge` is configured on the orchestrator and on `sol`, `luna`,
  `terra`, and `opus`. It is absent from both reviewer configs. The CEL
  expression matches common
  `gh pr merge`, REST `/merge`, and GraphQL `mergePullRequest` forms through both
  `Bash` and `sys_os_shell`. It is a speed bump, not containment — command
  construction and other clients bypass string matching. The durable controls are
  server-side GitHub protection or a worker token without merge scope, and
  provisioning them is out of scope for this bundle. On this repository the
  first of those is in place independently — see the ruleset disclosure in
  section 1, including the one thing it does not require.
- **The codex policy hook can fail open.** If the Codex app server is too old or
  workspace trust is rejected, that actor's named policies do not bind — for
  `sol`, `luna`, and `terra` that is `deny_merge`, `block_orchestration_skills`,
  and `deny_nested_agents`; for `reviewer_sol` it is `read_only_os`,
  `deny_shell`, `block_orchestration_skills`, and `deny_nested_agents`. Omnigent
  does report `policy_hook_disabled_reason` — that report *is* your warning. What
  is missing is enforcement: the bundle ships no executable preflight that
  consumes it, so nothing fails closed on it and nobody reads it for you.
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
four blocklisted names, but there is no dispatch header mechanism to tell a
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
