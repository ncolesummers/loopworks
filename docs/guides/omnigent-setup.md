# Set up Omnigent and run the orchestrated issue workflow

How to install the prerequisites, create a worktree, launch the
`.omnigent/polly-loopworks/` bundle, and drive an issue through it. Written from
an actual run of issue #267; every troubleshooting entry below is a failure that
really happened.

This page deliberately mixes Diátaxis modes — how-to, reference, explanation,
and a first run — because it is meant to be read end to end before you launch
the orchestrator for the first time. That is a recorded exception, not an
accident; see [#281](https://github.com/ncolesummers/loopworks/issues/281).

## How to read the claims in this guide

Two kinds of statement appear below, and they are not interchangeable:

- **Declared** — what a config file in this repository says. Verified by reading
  the repository. A declaration is an input to a runtime; it is not a promise
  the runtime honours it.
- **Runtime** — what Omnigent actually does. Verified against the installed
  package at
  `$(brew --prefix omnigent)/libexec/lib/python3.14/site-packages/omnigent/`,
  cited as `<pkg>/…`. Everything here was checked against `omnigent 0.9.0`;
  re-check on a different version.

Where the two diverge — and in two places below they diverge sharply — the
runtime wins.

> **What the bundle is.** `.omnigent/polly-loopworks/` is a **routing-only**
> bundle: a model-pinned roster of six workers plus routing guidance. Read
> "model-pinned" narrowly. Each worker declares a fixed model in its own
> `executor.model`, and none pins `claude-fable-5`. The Fable safeguard itself
> is an **orchestrator-only** policy: `deny_claude_fable_5` is configured at
> top-level `config.yaml:131-145` and nowhere else. It denies a direct
> `sys_session_send` override to Fable and denies `sys_session_create`; an
> ordinary declared model override is allowed. The six worker configs carry a
> different restriction — a `deny_nested_agents` policy that denies
> `sys_session_send` and `sys_session_create` outright, for any model.
>
> The bundle does **not** implement a managed issue-to-PR workflow. Review
> isolation, arbitration, reconciliation and termination, orchestrator
> containment, dispatch envelopes, ledger integrity, bootstrap gating, phase
> ownership, and publication sequencing are deferred to
> [issue #280](https://github.com/ncolesummers/loopworks/issues/280). The
> sequence in section 4 is a convention **you** run. Nothing in the bundle
> enforces it. See `.omnigent/polly-loopworks/ROUTING.md` and
> [ADR 0034](../adr/0034-project-scoped-polly-model-routing.md).
>
> **Platform.** macOS only today. Both reviewer configs declare
> `sandbox.type: darwin_seatbelt` with `write_paths: []`
> (`agents/reviewer_sol/config.yaml:24-27`,
> `agents/reviewer_opus/config.yaml:24-27`), and `ROUTING.md:36-37` states the
> bundle does not silently substitute an empty sandbox when one is missing. Read
> section 5 before you assume that declaration produces a seatbelt around the
> reviewer's harness — for `reviewer_sol` it does not.

## 0. Set your run variables first

Every command in this guide is written to run verbatim once these are set.
**There are no `<placeholders>` anywhere below.** Set these in the shell you
will work from, and re-export them in any new shell:

```sh
export REPO="ncolesummers/loopworks"
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

Presence on `PATH` is not readiness. Run both columns.

| Requirement | Presence check | Readiness check |
| --- | --- | --- |
| Omnigent CLI | `omnigent --version` | `omnigent diagnose` |
| Claude Code CLI | `command -v claude` | `claude auth status` → `"loggedIn": true` |
| Codex CLI | `command -v codex` | `codex login status` → exit 0 |
| Omnigent credentials | — | `omnigent config list` |
| GitHub CLI | `command -v gh` | `gh auth status` |
| Bun | `bun --version` | — |

The readiness commands are not invented for this guide: they are the same
probes Omnigent itself runs. `harness_cli_logged_in` shells out to
`claude auth status` (parsing the JSON `loggedIn` field) and to
`codex login status` (exit code only), because Claude Code stores its token in
the macOS Keychain rather than in a file
(`<pkg>/onboarding/harness_install.py:161,173`, `:1002-1044`).

`omnigent config list` is the one check that covers Omnigent's own view. A
ready machine prints a credential under both **Claude** and **Codex**:

```text
Credentials (by harness)
  Claude
    🎟️ subscription claude via claude CLI ✓ default
  Codex
    🎟️ subscription codex via codex CLI ✓ default
```

### 1.1 STOP criterion before you launch

**Do not launch until all four of these hold.** Nothing in Omnigent or in the
bundle will stop you, and the failure lands mid-run:

1. `claude auth status` reports `"loggedIn": true`.
2. `codex login status` exits 0.
3. `omnigent config list` shows a credential under both Claude and Codex.
4. `codex --version` is at least **0.137.0** and `claude --version` at least
   **2.1.161** — the enforced floors, `_CODEX_MIN_VERSION` and
   `_CLAUDE_MIN_VERSION` (`<pkg>/onboarding/harness_install.py:113,119`). An
   older Codex **silently disables tool-call enforcement** (`:174-179`). This is
   the same condition as the fail-open in section 5, and it is the one item here
   you can check without launching anything.

Why this is on you: `harness_is_configured` — the only gate between a dispatch
and a running worker — is **binary-only**. Its own docstring says an
"installed-but-not-logged-in CLI still returns `True` because auth failures
surface at run time rather than blocking dispatch"
(`<pkg>/onboarding/harness_readiness.py:442-465`). The host refuses a launch
only when the binary is missing or on an unsupported version
(`<pkg>/host/connect.py:1213-1222`). A machine can pass every presence check,
dispatch cleanly, and die on the first model turn.

The orchestrator uses `harness: claude-sdk` (`config.yaml:14`), which is not
CLI-gated at all — SDK harnesses always return `True` from that check. It needs
an Anthropic credential Omnigent can resolve, which is what `omnigent config
list` reports.

### 1.2 `GH_TOKEN` does not reach workers

This is the opposite of what you probably expect, and of what earlier drafts of
this guide said.

**Exporting `GH_TOKEN` in your shell does not give workers a GitHub token.**
Omnigent strips it, twice.

`GH_TOKEN` and `GITHUB_TOKEN` appear nowhere in `<pkg>/cli.py` or
`<pkg>/host/connect.py`. Two allowlists stand between your shell and a worker:

- **Shell → daemon.** `_build_host_daemon_env` keeps only
  `_RUNNER_ENV_ALLOWLIST` plus `_LOCAL_DAEMON_ENV_ALLOWLIST` plus the prefixes
  `ANTHROPIC_DEFAULT_`, `AZURE_OPENAI_`, `DATABRICKS_`, `MLFLOW_`, `OTEL_`,
  `OMNIGENT_`, `OPENAI_` (`<pkg>/cli.py:652-698`, `:2960-2996`).
- **Daemon → runner.** `_build_runner_env` keeps only `_RUNNER_ENV_ALLOWLIST`,
  the prefixes `LC_` / `MLFLOW_` / `OTEL_` / `OMNIGENT_OTEL_`, and
  `HARNESS_CREDENTIAL_ENV_VARS` (`<pkg>/host/connect.py:311-474`, `:560-660`).

`GH_TOKEN` is in none of them. The comment on the allowlist states the intent
plainly: "the host runs as the user, so its environment holds the user's
personal secrets (API keys, tokens). A runner has no need for those."

The semantic trap is `os_env.type: caller_process`. It means the **runner's**
process environment — and that environment has already been filtered by both
allowlists before any worker sees it. It does not mean your login shell.

There is an operator escape hatch, `OMNIGENT_RUNNER_ENV_PASSTHROUGH`
(`<pkg>/host/connect.py:498-506`, `:606-620`), and **on a local daemon it does
not rescue `GH_TOKEN`**: the variable name survives the first strip because of
the `OMNIGENT_` prefix, but `GH_TOKEN` itself does not, so the daemon has no
value left to forward. Verify both facts yourself:

```sh
"$(brew --prefix omnigent)/libexec/bin/python" - <<'PY'
import os
import omnigent.cli as cli
from omnigent.host.connect import _build_runner_env

shell = {
    "GH_TOKEN": "sentinel",
    "OMNIGENT_RUNNER_ENV_PASSTHROUGH": "GH_TOKEN",
    "PATH": "/usr/bin",
    "HOME": "/tmp",
}
os.environ.clear()
os.environ.update(shell)
daemon = cli._build_host_daemon_env(server_url=None)
runner = _build_runner_env(
    daemon,
    server_url="u",
    runner_id="r",
    binding_token="b",
    workspace="/tmp",
    parent_pid=1,
)
print("daemon has GH_TOKEN:", "GH_TOKEN" in daemon)
print("runner has GH_TOKEN:", "GH_TOKEN" in runner)
PY
```

Both print `False`.

**The practical consequence.** `HOME` *is* forwarded, so `gh` inside a worker
falls back to whatever it resolves from `~/.config/gh/` — not to your exported
token. Do not assume a worker's GitHub operations will authenticate the way
yours do. Before you rely on one, have the worker run `gh auth status` and
report the result. `GIT_TOKEN` / `GIT_USERNAME` are the only Git-adjacent names
Omnigent forwards deliberately
(`<pkg>/host/connect.py:496-512`), and they too die at the shell→daemon strip
on a local daemon, so they are not a workaround either.

**Do not treat this as containment.** A worker still has an unrestricted shell
and can read credential files under the forwarded `HOME`. What is true is
narrower and still useful: an exported `GH_TOKEN` is not the mechanism by which
a worker acts on GitHub, so provisioning one buys you nothing, and losing one
explains an authentication failure you would otherwise chase for an hour.

### 1.3 What the default-branch rulesets do and do not give you

Two rulesets target the default branch, both `enforcement: active`, both with an
empty `bypass_actors` list, both matching
`conditions.ref_name.include: ["~DEFAULT_BRANCH"]`:

- **20728131 "Require pull requests and CI on main"** — a `pull_request` rule and
  a `required_status_checks` rule.
- **17921291 "Copilot review for default branch"** — `deletion`,
  `non_fast_forward`, and `copilot_code_review`.

**What they reject while they exist.** Deletion of the default branch
(`deletion`); force-push or history rewrite (`non_fast_forward`); a direct push
that bypasses a pull request (`pull_request`); and a merge with red or missing
required checks — `validate`, `seeded-postgres-e2e`, and `commit-provenance`
(`required_status_checks`).

**Residual gaps even while both rulesets are active:**

- `required_approving_review_count: 0` — a green PR merges with no human
  approval. "The orchestrator never merges; you do" is a convention, not a
  server-enforced control.
- `strict_required_status_checks_policy: false` — a PR may merge against a stale
  base without re-running checks on the merged result.
- `required_review_thread_resolution: false` — a PR may merge with review threads
  still unresolved.
- `dismiss_stale_reviews_on_push: false` and `require_last_push_approval: false`
  — an approval survives further commits.
- `review_draft_pull_requests: false` on `copilot_code_review` — draft PRs
  receive no Copilot review, and this repository's workflow opens PRs as drafts.
- `review_on_push: false` on `copilot_code_review` — once a PR is marked ready it
  gets **one** Copilot review, and every later commit lands with no re-review.
  Combined with the previous entry, a draft PR that is readied and then pushed
  to repeatedly is reviewed exactly once, at the moment it was readied.

**These rulesets are revocable, not a boundary.** An empty bypass-actor list
prevents *bypassing* a ruleset; it does not prevent *administering* one. Your own
token reports `permissions.admin: true`, so you can edit, disable, or delete a
ruleset through the same API that reads it. Treat the rulesets as raising the
cost of a catastrophic action and leaving an audit trail.

**How to verify this yourself.** The list endpoint returns **summaries only** —
its objects contain exactly `_links`, `created_at`, `enforcement`, `id`, `name`,
`node_id`, `source`, `source_type`, `target`, `updated_at`. `bypass_actors`,
`rules`, and `conditions` are **absent keys**, not null values, so a `jq` filter
that names them will fabricate nulls and mislead you. Fetch each ruleset by id:

```sh
gh api "repos/$REPO/rulesets" --jq '.[0] | keys'   # summaries only
gh api "repos/$REPO/rulesets/20728131"             # enforcement detail
gh api "repos/$REPO/rulesets/17921291"
gh api "repos/$REPO" --jq .permissions
```

The classic endpoint `repos/$REPO/branches/main/protection` returns
`404 Branch not protected` here. That is a **false negative** — this repository
uses rulesets, not classic branch protection.

### 1.4 Harnesses

The roster is exactly six workers across two harnesses, so there are no extra
model vendors to configure beyond Claude Code and Codex. Because `reviewer_sol`
is codex-native and `reviewer_opus` is claude-native, you need **both** CLIs to
run cross-vendor review at all.

The orchestrator prompt instructs it to run `command -v codex claude || true` as
a routing preflight and to report any unavailable harness (`config.yaml:23-26`).
That is prompt guidance, not an executable check: the bundle ships no preflight
script. It is not true that nothing fails closed — the Codex executor raises
`ImportError` when it cannot resolve the `codex` CLI
(`<pkg>/inner/codex_executor.py:3070-3076`), and the host refuses to spawn for a
harness whose binary is missing (`<pkg>/host/connect.py:1213-1222`). What is
missing is an *up-front* preflight: nothing checks before you start, so a
dispatch to a missing harness fails at dispatch time rather than at launch time,
and a dispatch to an *unauthenticated* harness fails later still.

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
  `git worktree add -b` starts the branch from `HEAD` — follow this from a stale
  feature branch and the issue branch inherits it. Omit only `git fetch origin
  main` and the branch starts from the `origin/main` ref you already had, which
  may be days old. The two omissions have different failure modes; both are bad.
- If the branch already exists, or the target path is still registered after
  `git worktree prune`, stop and say so rather than reusing or removing it.

**Secret handling.** A fresh worktree also has no `.env.local`. Copy only the
`.env.local` values the change actually needs, and do not print them
(`ROUTING.md:85-89`). Keep this minimal on purpose: every implementer declares
`sandbox: none` and has an unrestricted shell, so anything you copy into the
worktree is readable by any implementer you dispatch there.

Why the location rule matters: `ROUTING.md:85-89` asks you to keep worktrees
outside **ignored** in-repository paths so `security:osv` can discover package
sources. The common in-repo location, `.claude/worktrees/…`, is gitignored
(`.gitignore:14`, `.claude/*`), and `security:osv` honours gitignore. Run from
there and `validate` fails with **"No package sources found"**, and the error
points nowhere near the real cause. Because `precommit` is
`commit:preflight && validate` (`package.json:46`), that failure blocks any
commit that actually runs the gate — but note the gate is supplied by a
separately installed pre-commit hook (`.pre-commit-config.yaml:1-9`), so a
checkout without the hook installed, or a `--no-verify` commit, is not stopped by
it. An in-repo worktree at a path that is *not* ignored is outside what
`ROUTING.md` warns about.

Do this bootstrap yourself, before you launch. `ROUTING.md:85-89` records it as
useful guidance and states plainly that no dispatched worker is guaranteed to
receive or complete those steps.

## 3. Launch the orchestrator

> **Read this before you type the launch command.**
>
> **You must pass the bundle path.** `omnigent polly` and a bare `omnigent` do
> not launch this bundle:
>
> - `omnigent polly --help` (0.9.0) documents that subcommand as shorthand for
>   `omnigent run` on Omnigent's own **packaged** polly agent — a different
>   agent, a different roster, and different policy arguments (see below).
> - A bare `omnigent` is not categorical. `omnigent run` first honours a
>   configured `default_agent` and `harness`
>   (`<pkg>/cli.py:7436-7464`, resolution at `:948-988`); only when neither is
>   configured does it derive one from your credentials (Claude → packaged
>   polly, else Codex, else Pi). If you have configured this repository's bundle
>   as `default_agent`, a bare interactive `omnigent` selects **it**. In a
>   non-TTY invocation, bare `omnigent` prints help and exits 0 without
>   launching anything.
>
> Packaged polly is **not** policy-free. Its installed config declares
> `guardrails.policies` with `blast_radius`, `spawn_bounds`, and
> `headless_subagent_purpose_guard`
> (`<pkg>/resources/examples/polly/config.yaml:340-368`). The difference that
> matters is the **arguments**: packaged polly sets `gate_pushes: false` on the
> orchestrator ("Orchestrator runs unattended; don't ASK on push/merge/deploy"),
> where this bundle sets `gate_pushes: true` on the orchestrator
> (`config.yaml:97-102`). Launching the wrong one silently changes whether
> pushes are gated.

`.omnigent/polly-loopworks/` is a tracked directory (13 files under `git
ls-files`), so it is present in every worktree of a branch that contains it. You
launch it as an agent **directory**:

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

Two separate mechanisms decide what an actor can load. Conflating them is the
usual mistake, and the grant is much weaker than it looks.

**First, the grant — and it is not an exclusive boundary.** Each config declares
its own `skills:` list. The four implementers declare
`skills: [tdd-implement, browser-validate, commit-signed-pr]`. The orchestrator
(`config.yaml:6`) and **both reviewers**
(`agents/reviewer_sol/config.yaml:4`, `agents/reviewer_opus/config.yaml:4`)
declare `skills: none`. What that actually does depends on the harness, and in
neither case does it fence the actor off from this repository's own skills:

- **claude-native / claude-sdk.** `skills: none` emits `--setting-sources ""`,
  which suppresses **host**-skill discovery (`~/.claude/skills/`, project
  `.claude/skills/`). Bundle skills ride `--plugin-dir` and are **unaffected**
  (`<pkg>/inner/bundle_skills.py:62-116`). A **list** is weaker still: the same
  source notes the CLI "has no per-name skill allowlist flag, so the named
  subset is not enforced on native — bundle skills load via `--plugin-dir` and
  host skills follow the default sources." So `opus`'s three-name list does not
  restrict `opus` to three skills.
- **codex-native.** `skills: none` leaves `$CODEX_HOME/skills/` absent, and a
  list symlinks only the named skills into it
  (`<pkg>/inner/codex_executor.py:464-560`). That governs the `$CODEX_HOME`
  mechanism only. Codex *also* discovers `.agents/skills/` from the workspace,
  independently. Reproduce it from `$WORKTREE`:

  ```sh
  cd "$WORKTREE"
  CODEX_HOME="$(mktemp -d)" codex debug prompt-input test 2>&1 \
    | grep -o '\.agents/skills/[a-z-]*/SKILL\.md' | sort -u
  ```

  With a `CODEX_HOME` containing no skills at all, that still lists
  `.agents/skills/implement-issue/SKILL.md`,
  `.agents/skills/implement-issue-pr/SKILL.md`, `tdd-implement`,
  `browser-validate`, and `commit-signed-pr`. `skills: none` did not hide them.

The consequence: for the codex-native actors — `sol`, `luna`, `terra`, and
`reviewer_sol` — the **only** thing between a visible ORCHESTRATION skill and a
load is the blocklist policy, and that policy is exactly the one that can fail
open (section 5).

**Second, the blocklist.** Every actor — the orchestrator and all six workers —
carries the same four-name `block_orchestration_skills` policy, routed to
`omnigent.policies.builtins.safety.block_skills`. The denial is an explicit
`blocked:` list written out in each config, not computed from the classification
map. At runtime it intercepts three paths and nothing else: the `load_skill` /
`read_skill_file` runner tools, the native `Skill` tool via the `PreToolUse`
hook, and `/skill-name` slash commands
(`<pkg>/policies/builtins/safety.py:332-400`). Matching is case-insensitive. A
plain file read of a `SKILL.md` is none of those three and is not blocked.

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
plugin namespace (ADR 0034:47-50) and would otherwise reach it by its qualified
form. CRAFT names appear in no blocklist.

Why the split matters, per skill:

- `implement-issue` and `implement-issue-pr` are real repo skills in
  `.agents/skills/`, and each runs a whole issue end to end — AC extraction,
  test-plan-first TDD, adversarial review, acceptance evidence. They differ on
  publication: `implement-issue` explicitly stops before committing and forbids
  commits, pushes, and PRs without separate authorization
  (`.agents/skills/implement-issue/SKILL.md:21-26` and `:60-64`), while only
  `implement-issue-pr` isolates a worktree, commits, and opens draft PRs. Either
  way, a worker that loaded one would review its own work.
- The bundle's own `orchestrate-issue-pr` is **not** such a workflow. Its
  `SKILL.md` is a reserved placeholder that states PR #268 implements no
  issue-to-PR workflow and defers the contract to
  [issue #280](https://github.com/ncolesummers/loopworks/issues/280). It is
  blocklisted as a reserved name, not as a working workflow.

CRAFT skills do a bounded piece of work and return.

Treat a classification edit as a policy change. CI pins the expected
classification map independently, so an edit fails with "classification changed -
this is a policy change" rather than silently recomputing a smaller blocklist
(ADR 0034:54-57), and discovery fails on an unclassified skill, a duplicate
resolved name, or a basename/frontmatter-name mismatch.

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
   orchestrator (`config.yaml:103-114`) and on the four implementers only, and it
   is best-effort. The two reviewer configs carry no `deny_merge` policy;
   instead each denies the named shell tools through a `deny_shell` CEL policy
   (`agents/reviewer_sol/config.yaml:41-50`,
   `agents/reviewer_opus/config.yaml:41-50`). For `reviewer_opus`, which is
   claude-native, that policy is the control. For `reviewer_sol`, which is
   codex-native, it is subject to the fail-open in section 5 — if the policy hook
   does not bind, `deny_shell` does not bind either, and the reviewer is not
   shell-free.

You must assemble what the reviewers see. Give each reviewer the diff and the
acceptance contract as files rather than a pointer to the implementer's
worktree — but understand that this is your discipline, not a property of the
bundle. Both reviewer prompts say so explicitly: *"Do not assume packet
isolation."*

Reviewers declare real mutation controls — `read_only_os`, `deny_shell`,
`blast_radius` with `gate_pushes: true`, `permission_mode: plan` on
`reviewer_opus`, and `yolo: false` on `reviewer_sol` — but read section 5 on
what the declared sandbox does and does not become at runtime before you count
it among them.

Only the orchestrator declares a terminal — `terminals.shell`, running `bash`,
in the bundle's `config.yaml:76-84`. No worker config declares one, and the
bundle defines no worker-takeover mechanism.

## 5. Known gaps — read before you trust the guardrails

These are recorded honestly rather than papered over. The project's rule is that a
guard which lies is worse than an absent guard.

- **`darwin_seatbelt` on `reviewer_sol` is not a seatbelt.** For a codex-native
  actor the declared `os_env.sandbox` is not instantiated as a macOS sandbox at
  all. `_sandbox_mode` reads only whether `sandbox.type` is `"none"` and whether
  `write_paths` is non-empty, and maps the result onto a Codex sandbox-mode
  *string*: `write_paths: []` with a non-`none` type becomes `"read-only"`
  (`<pkg>/inner/codex_executor.py:1930-1937`). Worse, the very next lines
  upgrade it: `if tools and sandbox_mode == "read-only": sandbox_mode =
  "workspace-write"` (`:3335-3337`). So a `reviewer_sol` turn that registers any
  tools runs **workspace-write**, not read-only, from a config that reads as a
  no-write seatbelt. `<pkg>/inner/claude_native_executor.py` contains no
  `sandbox` handling either. The genuine seatbelt path,
  `create_os_environment` → `resolve_sandbox`, is reached from
  `<pkg>/tools/manager.py:600-620` — it governs Omnigent's own `sys_os_*` tools,
  not the harness CLI's native tools. Treat `permission_mode: plan`
  (`reviewer_opus`) and the `deny_shell` policy as the controls that exist, and
  do not count the sandbox declaration among them.
- **No Gemini worker, and no tiebreak seat.** No Gemini worker is registered, and
  a unit test asserts the roster directory does not contain one
  (`polly-loopworks-spec.test.ts:263`). ADR 0034:23-24 records the reason: the
  available Antigravity native executor does not bind the worker prompt, the
  policy hook, or the read-only sandbox. The roster therefore has no third-model
  seat to break a tie, so a reviewer disagreement that survives reconciliation
  escalates to **you**.
- **No worktree confinement — deleted, not partial.** No checked-in mechanism
  confines or relocates a worker to a sibling worktree. Every implementer runs
  `cwd: .` with `sandbox: none` and `blast_radius(gate_pushes: false)`; the
  orchestrator's own cwd check is self-attested, and its terminal keeps
  `allow_cwd_override: true` (`config.yaml:79`). The earlier guard was removed as
  unenforceable rather than kept as a partial one. Launching from the correct
  worktree is an *operational precondition you must satisfy*: a mistaken launch
  can expose the main checkout or permit ungated pushes.
- **Skill grants do not fence off repo skills.** `skills: none` suppresses host
  discovery on Claude and the `$CODEX_HOME` mechanism on Codex, but Codex still
  sees `.agents/skills/` from the workspace, and a list-valued `skills:` does not
  restrict a claude-native actor at all. See section 3.1 for the reproduction.
  The blocklist is the control, and it binds **named skill loads only** — a
  worker with an unrestricted shell can still read a blocked skill's file.
- **Merge denial covers five of the seven actors, and is best-effort even
  there.** `deny_merge` is configured on the orchestrator and on `sol`, `luna`,
  `terra`, and `opus`. It is absent from both reviewer configs. The CEL
  expression matches common `gh pr merge`, REST `/merge`, and GraphQL
  `mergePullRequest` forms through both `Bash` and `sys_os_shell`. It is a speed
  bump, not containment — command construction and other clients bypass string
  matching. `ROUTING.md:77-78` names the durable controls as server-side branch
  protection or a worker token without merge scope, and puts provisioning them
  out of scope for this bundle.
- **The codex policy hook can fail open.** If the Codex app server is too old or
  workspace trust is rejected, that actor's named policies do not bind
  (`ROUTING.md:31-35`, ADR 0034:39-45) — for `sol`, `luna`, and `terra` that is
  `blast_radius`, `deny_merge`, `block_orchestration_skills`, and
  `deny_nested_agents`; for `reviewer_sol` it is `blast_radius`, `read_only_os`,
  `deny_shell`, `block_orchestration_skills`, and `deny_nested_agents`. Losing
  `blast_radius` matters on its own: it is the policy that denies force-push and
  gates ordinary pushes, exercised at `polly-loopworks-spec.test.ts:484-488`.
  Omnigent does report `policy_hook_disabled_reason` — that report *is* your
  warning. What is missing is enforcement: the bundle ships no executable
  preflight that consumes it, so nothing fails closed on it and nobody reads it
  for you. Section 1.1 item 4 is the pre-launch check that reduces this risk.
- **The orchestrator is not contained.** It keeps an unrestricted shell
  (`config.yaml:76-84`, `sandbox: none`) and can launch clients outside the named
  agent tools. Denying nested-agent tools and custom session creation is defense
  in depth; `ROUTING.md:61-64` states the roster and prompt are routing guidance,
  not an enforceable dispatch allowlist.
- **Arbitration, review-packet isolation, and orchestrator containment are
  absent, not partial.** They are deferred to
  [issue #280](https://github.com/ncolesummers/loopworks/issues/280), along with
  reconciliation and termination, dispatch-envelope validation, ledger integrity,
  bootstrap gating, and publication sequencing. Dispatch headers, a
  `.polly/workflow-state.md` ledger, and separate review artifacts are
  conventions under consideration — not mechanisms that exist today
  (`ROUTING.md:82-89`).

## 6. Troubleshooting — real failures from the #267 run

**The bundle does not appear in the agent picker.** The picker enumerates agents
registered with the Omnigent server (`<pkg>/chat.py:1250`), not directories on
disk, so an unregistered bundle is not among them. Launch it by path instead —
`omnigent run --help` (0.9.0) states an agent may be a YAML file or a directory.
That is expected, not a broken install.

**A worker deleted my `.polly/` files.** `.polly/` is gitignored
(`.gitignore:31`) and excluded from markdownlint
(`.markdownlint-cli2.yaml:16`), and read-only workers treat untracked files as
scratch. Both reviewer configs declare `cwd_allow_hidden: [.venv, .polly]`, but
no implementer policy stops a sweep, so say so in the dispatch. Separately:
`ROUTING.md:91-92` records `.polly/` as transient scratch, not an integrity or
publication boundary — never treat a local ledger there as verified state.

**A worker spawned its own reviewers.** A worker launched in this checkout can
reach the repo skills in `.agents/skills/`, which are written for a single
all-powerful agent — that reachability is exactly why `implement-issue` and
`implement-issue-pr` are on the blocklist rather than merely absent from the
bundle, and section 3.1 shows they stay *visible* to a codex-native worker even
under `skills: none`. Every actor's `block_orchestration_skills` policy denies
the four blocklisted names, but there is no dispatch header mechanism to tell a
worker that review is owned upstream — put that in your own dispatch text. If you
see nested review, check whether the blocklist has drifted from the skill set,
and whether the actor is one of the codex-native four whose hook can fail open.

**"already has a launching or running turn."** This does **not** mean you cannot
send the worker anything. Omnigent accepts a message during an active turn: it
buffers the message and, for eligible harnesses, forwards it as true mid-turn
input; the POST returns HTTP 202 with `status: buffered` and the detail "Message
buffered; active turn will process it."
(`<pkg>/runner/app.py:6087-6143`). Native harnesses and turns awaiting an
approval are buffered rather than injected, so those arrive on the next turn.
Sending a correction mid-turn is worth doing — just do not assume it lands
immediately. What is still true: nothing makes a running worker re-read a file
you changed underneath it.

**A multi-line prompt vanished in a TUI worker.** Write the content to a file and
send a one-line prompt pointing at the path.

**Two ADRs with the same number.** `main` moving can land an ADR at the number your
branch used. Git will not warn you — the filenames differ, so both merge cleanly.
Check `docs/adr/` after every rebase.

**Playwright failing for no reason.** Two `validate` runs at once starve an M1 and
produce fake e2e failures. Run gates serially and re-run a spec alone before
believing it.
