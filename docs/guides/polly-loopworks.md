# Running the polly-loopworks orchestrator

A human guide to setting up Omnigent and driving an issue through the managed
workflow. Written from an actual run of issue #267; every troubleshooting entry
below is a failure that really happened.

> Scope: this bundle is **macOS-only** today. The reviewer sandbox resolves to
> `darwin_seatbelt`; on Linux without `bwrap` the equivalent silently degrades to
> no sandbox, so Linux is explicitly unsupported rather than quietly unsafe.

## 1. Prerequisites

| Requirement | Check | Notes |
| --- | --- | --- |
| Claude Code CLI | `command -v claude` | required — Reviewer B and the Opus worker |
| Codex CLI | `command -v codex` | required — the Sol/Luna/Terra workers |
| GitHub CLI, authenticated | `gh auth status` | needed for issues, PRs, provenance |
| `GH_TOKEN` exported | `echo ${GH_TOKEN:+set}` | see below — this bites every time |
| Bun | `bun --version` | all repo gates |

Delegated workers do **not** inherit your macOS Keychain, so `gh` inside a worker
reports an invalid token even though it works in your terminal. Put this in your
shell profile:

```sh
export GH_TOKEN="$(gh auth token)"
```

Optional workers (`opencode`, `cursor`, `hermes`, `pi`, `agy`) are not required.
The orchestrator preflights the roster and routes only to CLIs it finds. If
neither `claude` nor `codex` is present you cannot run cross-vendor review at all,
and the orchestrator will say so rather than silently degrading.

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

## 3. Launch the orchestrator

`config_path` is resolved relative to the launching session's working directory
and is rejected if it escapes that directory. Launch with your cwd set to the
worktree from step 2, pointing at:

```text
.omnigent/polly-loopworks/
```

Note: the agent picker lists only `*.yaml` files sitting directly in
`.omnigent/agent-configs/`. This bundle is a *directory* (it has `agents/` and
`skills/`), so it launches fine by path but will not appear in that menu. That is
expected, not a broken install.

## 4. What you do, and what the agents do

| Phase | Owner |
| --- | --- |
| 0 intake, PR shape | orchestrator |
| 1 worktree verification | orchestrator |
| 2 issue + acceptance-criteria extraction | orchestrator |
| 3-4 test plan, then TDD red -> green | implementer (one session — do not split) |
| 5 browser validation | implementer |
| 6 dual adversarial review | two reviewers, different providers, in parallel |
| 7 validation gates | orchestrator, **serially** |
| 8 signed commit + draft PR | implementer |
| 9 evidence + handoff | orchestrator |
| 10 merge | **you** |

Your three jobs:

1. **Approve the plan** before implementation starts.
2. **Arbitrate** a disagreement that survives one reconciliation round. There is no
   automated tiebreak seat — that is deliberate, see Known gaps.
3. **Merge.** No agent merges, ever.

Reviewers receive a diff and an acceptance contract as *files*, never a pointer to
the implementer's worktree, and they never edit. If you want to watch or take over,
open the worker in the Subagents panel — every CLI worker runs in a real terminal.

## 5. Known gaps — read before you trust the guardrails

These are recorded honestly rather than papered over. The project's rule is that a
guard which lies is worse than an absent guard.

- **No worktree confinement.** `OMNIGENT_RUNNER_WORKSPACE` overrides the configured
  cwd, so no policy currently confines a worker to its worktree. Launching from the
  correct worktree is an *operational precondition you must satisfy* — if you launch
  from the main checkout, a worker can write it.
- **Merge denial is a speed bump, not containment.** It pattern-matches command
  strings, so `gh api` and `-R` forms get through. The durable control is GitHub
  branch protection or a worker token without merge scope.
- **The codex policy hook can fail open.** If the codex app-server is too old or
  trust is rejected, reviewer read-only policies silently do not bind.
- **No automated tiebreak.** The Gemini worker was removed because that harness has
  no policy hook and discards its system prompt. Surviving disagreements come to you.

## 6. Troubleshooting — real failures from the #267 run

**A worker deleted my `.polly/` files.** `.polly/` is gitignored, and read-only
workers treat untracked files as scratch. It carries a do-not-delete header and is
excluded from lint; if a worker still sweeps it, say so in the dispatch.

**A worker spawned its own reviewers.** Repo skills are discovered by walking up
from cwd, so a worker in this checkout finds skills written for a single all-powerful
agent. Managed workers deny those skills and get a phase header telling them review is
owned upstream. If you see nested review, the block list has drifted from the skill set.

**"already has a launching or running turn."** You cannot inject new information into
a worker mid-pass. Append it to the dispatch packet instead — workers re-read the
packet and `.polly/workflow-state.md` before committing.

**A multi-line prompt vanished in a TUI worker.** Write the content to a file and send
a one-line prompt pointing at the path. This is why review packets are files.

**Two ADRs with the same number.** `main` moving can land an ADR at the number your
branch used. Git will not warn you — the filenames differ, so both merge cleanly.
Check `docs/adr/` after every rebase.

**Playwright failing for no reason.** Two `validate` runs at once starve an M1 and
produce fake e2e failures. Run gates serially and re-run a spec alone before
believing it.
