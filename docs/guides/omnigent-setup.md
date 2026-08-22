# Set up Omnigent and run the orchestrated issue workflow

How to install the prerequisites, create a worktree, launch the
`.omnigent/polly-loopworks/` bundle, and drive an issue through it. Written from
an actual run of issue #267; every troubleshooting entry below is a failure that
really happened.

This page deliberately mixes Diátaxis modes — how-to, reference, explanation,
and a first run — because it is meant to be read end to end before you launch
the orchestrator for the first time. That is a recorded exception, not an
accident; see [#281](https://github.com/ncolesummers/loopworks/issues/281).

Two kinds of claim appear below. **Declared** claims are what a config file in
this repository says; a declaration is an input to a runtime, not a promise the
runtime honours it. **Runtime** claims are what Omnigent actually does, cited as
`<pkg>/…` against
`$(brew --prefix omnigent)/libexec/lib/python3.14/site-packages/omnigent/` and
checked on `omnigent 0.9.0` — re-check on a different version. Where the two
diverge, and in section 5 they diverge sharply, the runtime wins.

> **What the bundle is.** `.omnigent/polly-loopworks/` is a **routing-only**
> bundle: a model-pinned roster of six workers plus routing guidance. It does
> **not** implement a managed issue-to-PR workflow — that is deferred to
> [issue #280](https://github.com/ncolesummers/loopworks/issues/280), as
> section 5 details. The sequence in section 4 is a convention **you** run;
> nothing in the bundle enforces it. See `.omnigent/polly-loopworks/ROUTING.md`
> and [ADR 0034](../adr/0034-project-scoped-polly-model-routing.md).
>
> **Platform.** macOS only today: both reviewer configs declare
> `sandbox.type: darwin_seatbelt` (`agents/reviewer_sol/config.yaml:24-27`,
> `agents/reviewer_opus/config.yaml:24-27`).

## 0. Set your run variables first

Every command in this guide is written to run verbatim once these are set.
**There are no `<placeholders>` anywhere below.** Set these in the shell you
will work from, and re-export them in any new shell:

```sh
export MAIN="$HOME/Documents/LoopWorks"         # your main checkout
export ISSUE=281                                # the issue number you are working
export SLUG="omnigent-setup-guide"              # kebab-case slug from the issue title
export CATEGORY="docs"                          # agent | feat | fix | docs | chore
export WORKTREE="$MAIN/../loopworks-worktrees/$ISSUE-$SLUG"
export BRANCH="$CATEGORY/$ISSUE-$SLUG"
```

`CATEGORY` is the branch category this repo already uses: `agent` for issue work
an agent drives, otherwise `feat`, `fix`, `docs`, or `chore`.

`WORKTREE` is absolute on purpose. Relative worktree paths are the single most
common way to lose a step in this guide — see section 2.

## 1. Prerequisites

Presence on `PATH` is not readiness. Run both columns, and do not launch until
every readiness check passes.

| Requirement | Presence check | Readiness check |
| --- | --- | --- |
| Omnigent CLI | `omnigent --version` | `omnigent diagnose` |
| Claude Code CLI | `claude --version` ≥ **2.1.161** | `claude auth status` → `"loggedIn": true` |
| Codex CLI | `codex --version` ≥ **0.137.0** | `codex login status` → exit 0 |
| Omnigent credentials | — | `omnigent config list` |
| GitHub CLI | `command -v gh` | `gh auth status` |
| Bun | `bun --version` | — |

These are the same probes Omnigent itself runs. `harness_cli_logged_in` shells
out to `claude auth status` (parsing the JSON `loggedIn` field) and to
`codex login status` (exit code only), because Claude Code keeps its token in the
macOS Keychain rather than a file
(`<pkg>/onboarding/harness_install.py:161,173`, `:1002-1044`). The version floors
are the enforced `_CLAUDE_MIN_VERSION` and `_CODEX_MIN_VERSION` (`:113,119`); an
older Codex **silently disables tool-call enforcement** (`:174-179`), which is
the fail-open in section 5.

`omnigent config list` covers Omnigent's own view: a ready machine prints a
`subscription … via … CLI ✓ default` credential under both **Claude** and
**Codex**.

Checking all of this is on you, because nothing downstream will.
`harness_is_configured` — the only gate between a dispatch and a running worker
— is **binary-only**: its docstring says an "installed-but-not-logged-in CLI
still returns `True` because auth failures surface at run time rather than
blocking dispatch" (`<pkg>/onboarding/harness_readiness.py:442-465`). A machine
can pass every presence check, dispatch cleanly, and die on the first model
turn. The orchestrator's `harness: claude-sdk` (`config.yaml:14`) is not
CLI-gated at all; it needs an Anthropic credential Omnigent can resolve, which is
what `omnigent config list` reports.

You need **both** CLIs to run cross-vendor review at all: `reviewer_sol` is
codex-native and `reviewer_opus` is claude-native. The bundle ships no up-front
preflight, so a dispatch to a missing harness fails at dispatch time
(`<pkg>/host/connect.py:1213-1222`) rather than at launch, and a dispatch to an
unauthenticated harness fails later still.

## 2. Create the worktree — the rule that costs the most when missed

**Keep worktrees out of ignored in-repository paths.** A sibling directory
outside the repository is the simplest way to satisfy that.

The canonical procedure is `.agents/skills/implement-issue-pr/SKILL.md:42-69`.
Run it from the repository root. Section 0's `WORKTREE` is absolute, so this
works from any cwd:

```sh
cd "$MAIN"
git fetch origin main
git worktree list                     # confirm the target path is free
git worktree prune                    # clears registrations whose path is gone
git worktree add -b "$BRANCH" "$WORKTREE" origin/main
cd "$WORKTREE"
bun install                           # a fresh worktree has no node_modules
```

**Your cwd is now `$WORKTREE`.** Section 3 assumes that and restates it.

Two details the recipe depends on, both easy to skip:

- `origin/main` is the explicit start point. Omit that argument and
  `git worktree add -b` starts the branch from `HEAD` — run it from a stale
  feature branch and the issue branch inherits it. Omit only `git fetch origin
  main` and the branch starts from an `origin/main` ref that may be days old.
- If the branch already exists, or the target path is still registered after
  `git worktree prune`, stop and say so rather than reusing or removing it.

**Secret handling.** A fresh worktree also has no `.env.local`. Copy only the
`.env.local` values the change actually needs, and do not print them
(`ROUTING.md:85-89`). Keep this minimal on purpose: every implementer declares
`sandbox: none` and has an unrestricted shell, so anything you copy into the
worktree is readable by any implementer you dispatch there.

Why the location rule matters: `ROUTING.md:85-89` asks you to keep worktrees
outside **ignored** in-repository paths so `security:osv` can discover package
sources. The common in-repo location `.claude/worktrees/…` is gitignored
(`.gitignore:14`), and `security:osv` honours gitignore, so `validate` fails
there with **"No package sources found"** — an error that points nowhere near the
real cause. Because `precommit` is `commit:preflight && validate`
(`package.json:46`), that failure blocks any commit that runs the gate.

Do this bootstrap yourself, before you launch: the same `ROUTING.md` lines state
that no dispatched worker is guaranteed to receive or complete these steps.

## 3. Launch the orchestrator

> **Read this before you type the launch command.**
>
> **You must pass the bundle path.** `omnigent polly` is shorthand for
> `omnigent run` on Omnigent's own **packaged** polly agent — a different agent
> with a different roster. A bare `omnigent` honours a configured
> `default_agent` before deriving one from your credentials
> (`<pkg>/cli.py:7436-7464`, resolution at `:948-988`), and in a non-TTY
> invocation it prints help and exits 0 without launching anything.
>
> The difference that matters is the **arguments**: packaged polly sets
> `gate_pushes: false` on the orchestrator
> (`<pkg>/resources/examples/polly/config.yaml:340-368`), where this bundle sets
> `gate_pushes: true` (`config.yaml:97-102`). Launching the wrong one silently
> changes whether pushes are gated.

`.omnigent/polly-loopworks/` is a tracked directory, so it is present in every
worktree of a branch that contains it. You launch it as an agent **directory**:

```sh
cd "$WORKTREE"                        # explicit: the launcher's cwd is the workers' cwd
omnigent run .omnigent/polly-loopworks
```

`omnigent run --help` (0.9.0) documents the contract this relies on: "AGENT may
be an agent YAML file or an agent directory."

**Your cwd at launch is the only thing that sets the workers' cwd.** The
orchestrator and every worker declare `os_env.cwd: .`, so each one inherits the
launching process's working directory. Nothing in the bundle re-anchors a worker
to a different directory, and nothing verifies where you launched from — see
[Known gaps](#5-known-gaps--read-before-you-trust-the-guardrails). There is no
launcher flag to fix it afterwards.

### 3.1 CRAFT and ORCHESTRATION skills

Two separate mechanisms decide what an actor can load, and only the second one
is a control.

**The `skills:` grant is not a boundary.** The four implementers declare
`skills: [tdd-implement, browser-validate, commit-signed-pr]`; the orchestrator
(`config.yaml:6`) and both reviewers (`agents/reviewer_sol/config.yaml:4`,
`agents/reviewer_opus/config.yaml:4`) declare `skills: none`. Neither form fences
an actor off from this repository's own skills in `.agents/skills/`. On
claude-native and claude-sdk, `skills: none` suppresses only **host**-skill
discovery, and a named list is not enforced at all because the CLI has no
per-name allowlist flag (`<pkg>/inner/bundle_skills.py:62-116`). On codex-native
the grant governs the `$CODEX_HOME/skills/` mechanism only
(`<pkg>/inner/codex_executor.py:464-560`); Codex still discovers
`.agents/skills/` from the workspace independently.

**The blocklist is the control.** Every actor — the orchestrator and all six
workers — carries the same four-name `block_orchestration_skills` policy, routed
to `omnigent.policies.builtins.safety.block_skills`. It intercepts three paths
and nothing else, case-insensitively: the `load_skill` / `read_skill_file`
runner tools, the native `Skill` tool via the `PreToolUse` hook, and
`/skill-name` slash commands (`<pkg>/policies/builtins/safety.py:332-400`). A
plain file read of a `SKILL.md` is none of those three and is not blocked.

The classification map lives in the repo-owned
`.omnigent/polly-loopworks/.claude-plugin/plugin.json`, under
`metadata.loopworks.skillClassifications` — never in skill frontmatter, so
reinstalling a vendored upstream skill cannot erase the repo's policy:

| Class | Skills in the classification map |
| --- | --- |
| CRAFT | `agent-browser`, `browser-validate`, `commit-signed-pr`, `eve`, `gh-stack`, `tdd-implement`, and the bundle-qualified `polly-loopworks:browser-validate`, `polly-loopworks:commit-signed-pr`, `polly-loopworks:tdd-implement` |
| ORCHESTRATION | `implement-issue`, `implement-issue-pr`, `polly-loopworks:orchestrate-issue-pr` |

The runtime blocklist is the separate `orchestrationBlocklist` key in the same
manifest, and it has **four** names: those three ORCHESTRATION entries plus bare
`orchestrate-issue-pr`. The extra entry is the point — a Claude worker resolves
bundle skills under the shared plugin namespace (ADR 0034:47-50), so the reserved
name is denied in both its bare and qualified forms. CRAFT names appear in no
blocklist; each does a bounded piece of work and returns. `implement-issue` and
`implement-issue-pr` are blocked because each runs a whole issue end to end, so a
worker that loaded one would review its own work; the bundle's own
`orchestrate-issue-pr` is a reserved placeholder deferring its contract to #280.

Treat a classification edit as a policy change: CI pins the expected map
independently, so an edit fails with "classification changed - this is a policy
change" rather than silently recomputing a smaller blocklist (ADR 0034:54-57).

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
3. **Merge.** No agent should merge. A best-effort `deny_merge` policy is
   configured on the orchestrator (`config.yaml:103-114`) and the four
   implementers only; the reviewers instead deny the named shell tools through a
   `deny_shell` CEL policy (`agents/reviewer_sol/config.yaml:41-50`,
   `agents/reviewer_opus/config.yaml:41-50`), which is the control for
   claude-native `reviewer_opus` but is subject to the section 5 fail-open for
   codex-native `reviewer_sol`.

You must assemble what the reviewers see. Give each reviewer the diff and the
acceptance contract as files rather than a pointer to the implementer's
worktree — that is your discipline, not a property of the bundle. Both reviewer
prompts say so explicitly: *"Do not assume packet isolation."*

Only the orchestrator declares a terminal — `terminals.shell`, running `bash`,
in `config.yaml:76-84`. No worker config declares one, and the bundle defines no
worker-takeover mechanism.

## 5. Known gaps — read before you trust the guardrails

These are recorded honestly rather than papered over. The project's rule is that
a guard which lies is worse than an absent guard.

- **`darwin_seatbelt` on `reviewer_sol` is not a seatbelt.** For a codex-native
  actor the declared `os_env.sandbox` is never instantiated as a macOS sandbox.
  `_sandbox_mode` maps `write_paths: []` with a non-`none` type onto the Codex
  sandbox-mode string `"read-only"` (`<pkg>/inner/codex_executor.py:1930-1937`),
  and the next lines upgrade it: `if tools and sandbox_mode == "read-only":
  sandbox_mode = "workspace-write"` (`:3335-3337`). A `reviewer_sol` turn that
  registers any tools runs **workspace-write**. `permission_mode: plan`
  (`reviewer_opus`) and `deny_shell` are the controls that exist; the sandbox
  declaration is not one of them.
- **No Gemini worker, and no tiebreak seat.** No Gemini worker is registered, and
  a unit test asserts the roster directory does not contain one
  (`polly-loopworks-spec.test.ts:263`); ADR 0034:23-24 records the reason, that
  the available Antigravity native executor binds neither the worker prompt, the
  policy hook, nor the read-only sandbox. The roster has no third-model seat to
  break a tie, so a reviewer disagreement that survives reconciliation escalates
  to **you**.
- **No worktree confinement — deleted, not partial.** No checked-in mechanism
  confines or relocates a worker to a sibling worktree. Every implementer runs
  `cwd: .` with `sandbox: none` and `blast_radius(gate_pushes: false)`; the
  orchestrator's own cwd check is self-attested, and its terminal keeps
  `allow_cwd_override: true` (`config.yaml:79`). The earlier guard was removed as
  unenforceable rather than kept as a partial one, so launching from the correct
  worktree is an *operational precondition you must satisfy*: a mistaken launch
  can expose the main checkout or permit ungated pushes.
- **Skill grants do not fence off repo skills.** The blocklist, not the `skills:`
  grant, is the control — and it binds **named skill loads only**, so a worker
  with an unrestricted shell can still read a blocked skill's file. See
  section 3.1.
- **Merge denial covers five of the seven actors, and is best-effort even
  there.** `deny_merge` is configured on the orchestrator and on `sol`, `luna`,
  `terra`, and `opus`, and is absent from both reviewer configs. Its CEL
  expression matches common `gh pr merge`, REST `/merge`, and GraphQL
  `mergePullRequest` forms through `Bash` and `sys_os_shell`, but command
  construction and other clients bypass string matching. `ROUTING.md:77-78` names
  the durable controls as server-side branch protection or a worker token without
  merge scope, and puts provisioning them out of scope for this bundle.
- **The codex policy hook can fail open.** If the Codex app server is too old or
  workspace trust is rejected, that actor's named policies do not bind
  (`ROUTING.md:31-35`, ADR 0034:39-45) — for `sol`, `luna`, and `terra` that is
  `blast_radius`, `deny_merge`, `block_orchestration_skills`, and
  `deny_nested_agents`; for `reviewer_sol` it adds `read_only_os` and
  `deny_shell`. Losing `blast_radius` matters on its own: it denies force-push
  and gates ordinary pushes (`polly-loopworks-spec.test.ts:484-488`). Omnigent
  reports `policy_hook_disabled_reason`, but the bundle ships no preflight that
  consumes it, so nothing fails closed and nobody reads it for you. The Codex
  version floor in section 1 is the pre-launch check that reduces this risk.
- **Arbitration, review-packet isolation, and orchestrator containment are
  absent, not partial.** They are deferred to
  [issue #280](https://github.com/ncolesummers/loopworks/issues/280), along with
  reconciliation and termination, dispatch-envelope validation, ledger integrity,
  bootstrap gating, and publication sequencing. The orchestrator meanwhile keeps
  an unrestricted shell (`config.yaml:76-84`, `sandbox: none`), and
  `ROUTING.md:61-64` states the roster and prompt are routing guidance, not an
  enforceable dispatch allowlist. Dispatch headers, a `.polly/workflow-state.md`
  ledger, and separate review artifacts are conventions under consideration, not
  mechanisms that exist today (`ROUTING.md:82-89`).

## 6. Troubleshooting — real failures from the #267 run

**The bundle does not appear in the agent picker.** The picker enumerates agents
registered with the Omnigent server (`<pkg>/chat.py:1250`), not directories on
disk, so an unregistered bundle is not among them. Launch it by path instead.
That is expected, not a broken install.

**A worker deleted my `.polly/` files.** `.polly/` is gitignored
(`.gitignore:31`) and excluded from markdownlint (`.markdownlint-cli2.yaml:16`),
and read-only workers treat untracked files as scratch. Both reviewer configs
declare `cwd_allow_hidden: [.venv, .polly]`, but no implementer policy stops a
sweep, so say so in the dispatch. `ROUTING.md:91-92` records `.polly/` as
transient scratch, not an integrity or publication boundary — never treat a local
ledger there as verified state.

**A worker spawned its own reviewers.** A worker launched in this checkout can
reach the repo skills in `.agents/skills/`, which are written for a single
all-powerful agent — that reachability is why `implement-issue` and
`implement-issue-pr` are blocklisted rather than merely absent from the bundle.
Nothing tells a worker that review is owned upstream, so put that in your own
dispatch text. If you see nested review, check whether the blocklist has drifted
from the skill set, and whether the actor is one of the codex-native four whose
hook can fail open.

**"already has a launching or running turn."** This does **not** mean you cannot
send the worker anything. Omnigent buffers the message and, for eligible
harnesses, forwards it as true mid-turn input; the POST returns HTTP 202 with
`status: buffered` (`<pkg>/runner/app.py:6087-6143`). Native harnesses and turns
awaiting an approval are buffered rather than injected, so those arrive on the
next turn. Nothing makes a running worker re-read a file you changed underneath
it.

**A multi-line prompt vanished in a TUI worker.** Write the content to a file and
send a one-line prompt pointing at the path.

**Two ADRs with the same number.** `main` moving can land an ADR at the number
your branch used. Git will not warn you — the filenames differ, so both merge
cleanly. Check `docs/adr/` after every rebase.

**Playwright failing for no reason.** Two `validate` runs at once starve an M1
and produce fake e2e failures. Run gates serially and re-run a spec alone before
believing it.
