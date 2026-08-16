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
> "model-pinned" narrowly. Each worker declares a fixed model in its own
> `executor.model`, and none pins `claude-fable-5`. The Fable safeguard itself
> is an **orchestrator-only** policy: `deny_claude_fable_5` is configured at
> top-level `config.yaml:131-145` and nowhere else, and the executing CEL probe
> reads it from the orchestrator config (`polly-loopworks-spec.test.ts:506-512`).
> It denies a direct `sys_session_send` override to Fable and denies
> `sys_session_create`; an ordinary declared model override is allowed. The six
> worker configs carry a different restriction — a `deny_nested_agents` policy
> that denies `sys_session_send` and `sys_session_create` outright, for any
> model.
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
> **Platform.** macOS only today, because the review roles are what pin it. Both
> reviewer configs request the `darwin_seatbelt` sandbox with no write paths
> (`agents/reviewer_sol/config.yaml:24-27`, `agents/reviewer_opus/config.yaml:24-27`).
> A Linux reviewer needs a separately verified `linux_bwrap` configuration;
> `ROUTING.md:36-37` states the bundle does not silently substitute an empty
> sandbox when one is missing, so Linux is unsupported rather than quietly
> unsafe.

## 1. Prerequisites

| Requirement | Check | Notes |
| --- | --- | --- |
| Omnigent CLI | `omnigent --version` | required — this is the launcher; see section 3 |
| Claude Code CLI | `command -v claude` | required — `opus` and `reviewer_opus` use `harness: claude-native` |
| Codex CLI | `command -v codex` | required — `sol`, `luna`, `terra`, and `reviewer_sol` use `harness: codex-native` |
| GitHub CLI, authenticated | `gh auth status` | needed for issues, PRs, provenance |
| `GH_TOKEN` exported | `echo ${GH_TOKEN:+set}` | see below — this bites every time |
| Bun | `bun --version` | all repo gates |

The Omnigent CLI is **not** installed by this repository — nothing in
`package.json`, `scripts/`, or `.github/` installs or vendors it. CI only fetches
the Omnigent *Python policy source* at a pinned revision so unit tests can import
the real policy handlers (`.github/workflows/ci.yml:176-191`); that is a test
fixture, not a launcher install. Obtain the CLI from Omnigent's own distribution.
Everything in section 3 was verified against `omnigent 0.9.0`; re-check
`omnigent run --help` if your version differs.

Delegated workers do **not** inherit your macOS Keychain, so `gh` inside a worker
reports an invalid token even though it works in your terminal. Put this in your
shell profile:

```sh
export GH_TOKEN="$(gh auth token)"
```

### 1.1 What the default-branch rulesets do and do not give you

That token gives every actor your full GitHub scope. Two rulesets target the
default branch, both `enforcement: active`, both with an empty `bypass_actors`
list, both matching `conditions.ref_name.include: ["~DEFAULT_BRANCH"]`:

- **20728131 "Require pull requests and CI on main"** — a `pull_request` rule and
  a `required_status_checks` rule.
- **17921291 "Copilot review for default branch"** — `deletion`,
  `non_fast_forward`, and `copilot_code_review`.

**What they reject while they exist.** Deletion of the default branch
(`deletion`); force-push or history rewrite (`non_fast_forward`); a direct push
that bypasses a pull request (`pull_request`); and a merge with red or missing
required checks — `validate`, `seeded-postgres-e2e`, and `commit-provenance`
(`required_status_checks`).

**The decisive caveat: these rulesets are revocable, not a boundary.** An empty
bypass-actor list prevents *bypassing* a ruleset. It does not prevent
*administering* one. The operator token reports `permissions.admin: true`, and a
repository administrator can edit, disable, or delete a ruleset through the same
API that reads it. Every actor inherits that token — the orchestrator and all six
workers declare `os_env.type: caller_process` with `sandbox: none` or a sandbox
that does not filter network calls — and the `deny_merge` CEL expression matches
only `gh` merge command strings (`config.yaml:108-114`), so it does not match a
ruleset-administration call at all. Treat the rulesets as raising the cost of a
catastrophic action and leaving an audit trail. Do not treat them as containment.
The durable fix is a worker token without the `administration` scope; that is
**not** provisioned today.

**Residual gaps even while both rulesets are active:**

- `required_approving_review_count: 0` — a green PR merges with no human
  approval. "The orchestrator never merges; you do" is a convention, not a
  server-enforced control.
- `strict_required_status_checks_policy: false` — a PR may merge against a stale
  base without re-running checks on the merged result.
- `required_review_thread_resolution: false` — a PR may merge with review threads
  still unresolved.
- `review_draft_pull_requests: false` on `copilot_code_review` — draft PRs
  receive no Copilot review, and this repository's workflow opens PRs as drafts.

**How to verify this yourself.** The list endpoint returns **summaries only** —
its payload has no usable `bypass_actors`, `rules`, or `conditions` (all three
come back `null`). You must fetch each ruleset by id:

```sh
gh api repos/OWNER/REPO/rulesets                       # ids and names only
gh api repos/OWNER/REPO/rulesets/20728131              # enforcement detail
gh api repos/OWNER/REPO/rulesets/17921291
```

The classic endpoint `repos/OWNER/REPO/branches/main/protection` returns
`404 Branch not protected` here. That is a **false negative** — this repository
uses rulesets, not classic branch protection.

### 1.2 Harnesses

The roster is exactly six workers across two harnesses, so there are no extra
model vendors to configure beyond Claude Code and Codex. Because `reviewer_sol`
is codex-native and `reviewer_opus` is claude-native, you need **both** CLIs to
run cross-vendor review at all.

The orchestrator prompt instructs it to run `command -v codex claude || true` as
a routing preflight and to report any unavailable harness (`config.yaml:23-26`).
That is prompt guidance, not an executable check: the bundle ships no preflight
script, and nothing fails closed if a harness is missing.

## 2. Create the worktree — the rule that costs the most when missed

**Keep worktrees out of ignored in-repository paths.** A sibling directory
outside the repository is the simplest way to satisfy that.

The canonical procedure is `.agents/skills/implement-issue-pr/SKILL.md:42-69`.
Run it from the repository root — the worktree path is relative, so running it
from inside another worktree puts the new tree somewhere nobody expects:

```sh
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
git worktree list                     # confirm the target path is free
git worktree prune                    # clears registrations whose path is gone
git worktree add -b "<feature>/<issue_#>-<issue_description>" \
  "../loopworks-worktrees/<issue_#>-<issue_description>" origin/main
cd "../loopworks-worktrees/<issue_#>-<issue_description>"
bun install                           # a fresh worktree has no node_modules
```

**Substitute every `<placeholder>` before running. They are not shell syntax** —
left as written, `<feature>` and `<issue_#>` parse as redirections in `zsh` and
`bash` and the command will not do what it looks like it does. `<feature>` is the
branch category this repo already uses — `agent` for issue work an agent drives,
otherwise `feat`, `fix`, `docs`, or `chore`. `<issue_#>` is the issue number and
`<issue_description>` a short kebab-case slug from the issue title.

Two details the recipe depends on, both easy to skip:

- `origin/main` is the explicit start point, and `git fetch origin main`
  refreshes it first. Omit either and the branch starts from whatever `HEAD`
  happens to be — follow this from a stale feature branch and the issue branch
  inherits it.
- If the branch already exists, or the target path is still registered after
  `git worktree prune`, stop and say so rather than reusing or removing it.

**Secret handling.** A fresh worktree also has no `.env.local`. Copy only the
`.env.local` values the change actually needs, and do not print them
(`ROUTING.md:85-89`). Keep this minimal on purpose: every implementer runs with
`sandbox: none` and an unrestricted shell, so anything you copy into the worktree
is readable by any implementer you dispatch there.

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

`.omnigent/polly-loopworks/` is a tracked directory (13 files under `git
ls-files`), so it is present in every worktree of a branch that contains it. You
launch it as an agent **directory**:

```sh
cd ../loopworks-worktrees/<issue_#>-<issue_description>   # substitute first
omnigent run .omnigent/polly-loopworks
```

`omnigent run --help` (0.9.0) documents the contract this relies on: "AGENT may
be an agent YAML file or an agent directory."

**Do not launch it with `omnigent polly`, and do not launch a bare `omnigent`.**
Per `omnigent polly --help` (0.9.0), that subcommand is shorthand for
`omnigent run` on Omnigent's own *packaged* polly agent — "the same agent a bare
`omnigent` launches when a Claude credential is configured." That is a different
agent from this repository's bundle, with a different roster and none of the
policies described here. The path argument is what selects this bundle.

**Your cwd at launch is the only thing that sets the workers' cwd.** The
orchestrator and every worker declare `os_env.cwd: .`, so each one inherits the
launching process's working directory. Nothing in the bundle re-anchors a worker
to a different directory, and nothing verifies where you launched from — see
[Known gaps](#5-known-gaps--read-before-you-trust-the-guardrails). So `cd` into
the worktree first; there is no launcher flag to fix it afterwards.

### 3.1 CRAFT and ORCHESTRATION skills

Two separate mechanisms decide what an actor can load, and conflating them is the
usual mistake.

**First, the grant.** Each config declares its own `skills:` list. The four
implementers declare `skills: [tdd-implement, browser-validate, commit-signed-pr]`.
The orchestrator (`config.yaml:6`) and **both reviewers**
(`agents/reviewer_sol/config.yaml:4`, `agents/reviewer_opus/config.yaml:4`)
declare `skills: none` — so a reviewer has no access to `tdd-implement` either,
not because it is blocked but because it was never granted.

**Second, the blocklist.** Every actor — the orchestrator and all six workers —
carries the same four-name `block_orchestration_skills` policy, routed to
`omnigent.policies.builtins.safety.block_skills`. The denial does not come from
the skills themselves and is not computed from the classification map; it is an
explicit `blocked:` list written out in each config.

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

Two limits worth knowing: the block binds **named skill loads only** — every
implementer keeps an unrestricted shell and can still read a blocked skill's file
— and on the codex-native actors (`sol`, `luna`, `terra`, `reviewer_sol`) the
whole policy hook can fail open, taking `block_orchestration_skills` with it
(see section 5).

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
   orchestrator and on the four implementers only, and it is best-effort. The two
   reviewer configs carry no `deny_merge` policy; instead each denies the named
   shell tools through a `deny_shell` CEL policy
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
isolation."* Reviewers do have real mutation controls: `read_only_os`, the
`deny_shell` denial of named shell tools, `blast_radius` with `gate_pushes: true`,
`permission_mode: plan` on `reviewer_opus`, and `yolo: false` on `reviewer_sol`.
Note which layer each lives in: the first three are `guardrails.policies` and
therefore fail open with the hook on `reviewer_sol`. The `darwin_seatbelt`
sandbox is declared under `os_env`, not `guardrails.policies`, so it is not one
of the named policies the fail-open disables.

Only the orchestrator declares a terminal — `terminals.shell`, running `bash`,
in the bundle's `config.yaml:76-84`. No worker config declares one, and the
bundle defines no worker-takeover mechanism.

## 5. Known gaps — read before you trust the guardrails

These are recorded honestly rather than papered over. The project's rule is that a
guard which lies is worse than an absent guard.

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
- **Merge denial covers five of the seven actors, and is best-effort even
  there.** `deny_merge` is configured on the orchestrator and on `sol`, `luna`,
  `terra`, and `opus`. It is absent from both reviewer configs. The CEL
  expression matches common `gh pr merge`, REST `/merge`, and GraphQL
  `mergePullRequest` forms through both `Bash` and `sys_os_shell`. It is a speed
  bump, not containment — command construction and other clients bypass string
  matching. `ROUTING.md:77-78` names the durable controls as server-side branch
  protection or a worker token without merge scope, and puts provisioning them
  out of scope for this bundle. On this repository the server-side rulesets exist
  but are administrable by the same token every actor inherits, so they are not a
  substitute — see section 1.1.
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
  for you.
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

**The bundle does not appear in the agent picker.** The picker lists single
`*.yaml` agent configs; this bundle is a *directory* (`agents/`, `skills/`,
`.claude-plugin/`). Launch it by path instead — `omnigent run --help` (0.9.0)
states an agent may be a YAML file or a directory. That is expected, not a broken
install.

**A worker deleted my `.polly/` files.** `.polly/` is gitignored
(`.gitignore:31`) and excluded from markdownlint
(`.markdownlint-cli2.yaml:16`), and read-only workers treat untracked files as
scratch. Reviewer sandboxes explicitly allow reading it via
`cwd_allow_hidden: [.venv, .polly]`, but no implementer policy stops a sweep, so
say so in the dispatch. Separately: `ROUTING.md:91-92` records `.polly/` as
transient scratch, not an integrity or publication boundary — never treat a local
ledger there as verified state.

**A worker spawned its own reviewers.** A worker launched in this checkout can
reach the repo skills in `.agents/skills/`, which are written for a single
all-powerful agent — that reachability is exactly why `implement-issue` and
`implement-issue-pr` are on the blocklist rather than merely absent from the
bundle. Every actor's `block_orchestration_skills` policy denies the four
blocklisted names, but there is no dispatch header mechanism to tell a worker
that review is owned upstream — put that in your own dispatch text. If you see
nested review, check whether the blocklist has drifted from the skill set, and
whether the actor is one of the codex-native four whose hook can fail open.

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
