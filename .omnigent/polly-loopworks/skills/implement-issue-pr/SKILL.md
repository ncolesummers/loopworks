---
name: implement-issue-pr
description: Orchestrate a LoopWorks GitHub issue through isolated TDD, dual adversarial review, signed commits, and a draft PR without letting the orchestrator edit or merge.
---

# Implement Issue PR (Orchestrator Shape)

Use this bundle-local variant for an issue implementation managed by
`polly-loopworks`. Root and directory-scoped `AGENTS.md` files, relevant ADRs,
and the repository's existing `.agents/skills/implement-issue-pr/SKILL.md`
remain authoritative. This skill assigns each phase to the component that may
perform it without breaking TDD evidence, reviewer independence, or contributor
provenance.

Default to one draft PR. Use dependent stacked PRs only when the user has
authorized that shape and the root guide selects it. Preserve all user work and
never broaden a worker's write scope beyond its issue worktree.

## Phase ownership

| Phase | Work | Owner |
| --- | --- | --- |
| 0 | Intake, authorization, issue identity, and PR-shape decision | **ORCHESTRATOR** |
| 1 | Fetch/isolate, validate the supplied worktree, install dependencies | **ORCHESTRATOR** |
| 2 | Read issue/comments/guides/ADRs and extract numbered ACs | **ORCHESTRATOR** |
| 3 | Map every AC to a deterministic test plan | **IMPLEMENTING worker** |
| 4 | Write tests, demonstrate RED, implement minimally, reach GREEN | **Same IMPLEMENTING worker session as phase 3** |
| 5 | Main, negative, responsive, and accessibility browser validation when user-visible | **IMPLEMENTING worker** |
| 6 | Independent adversarial review of the first and final green diffs | **`reviewer_sol` and `reviewer_opus`** |
| 7 | Run the repository's required validation gates and collect statuses | **ORCHESTRATOR** |
| 8 | Preflight, signed commit, signature check, push, draft PR, provenance | **IMPLEMENTING worker** |
| 9 | Confirm draft status, branch/head binding, review stamp, and publication boundary | **ORCHESTRATOR** |
| 10 | Assemble the AC-to-evidence handoff and report every gap | **ORCHESTRATOR** |

## 0. Intake and PR shape — orchestrator

Confirm the issue number, authorized branch/worktree, and requested publication
authority. Default to one draft PR. Never silently convert a request into a
stack. Record that no agent may mark the PR ready or merge it.

## 1. Isolation — orchestrator

Create or validate the issue worktree outside the main checkout, then run
`bun install --frozen-lockfile` inside it and confirm no tracked file changed.
If installation would change the lockfile, stop and route that explicit change
through the implementing worker's TDD/review scope instead of contaminating the
diff during orchestration. Never reuse, reset, delete, switch, or rebase a
branch or worktree that the workflow did not create. Every later repository
command runs in the issue worktree.

## 2. Acceptance contract — orchestrator

Read `gh issue view <n> --comments`, root `AGENTS.md`, and the nearest guide for
each changed directory. Read relevant ADRs. Extract explicit numbered ACs and
flag ambiguity or conflict instead of silently resolving it. Write the issue,
ACs, and later test plan to durable handoff files.

## 3–4. Test plan and TDD — one implementing worker session

Select `sol` by default, `luna` for volume/mechanical work, `terra` for the
mid-tier, or `opus` for architectural/ambiguous work. Dispatch phase 3 and
continue phase 4 in that exact conversation.

**Phases 3 and 4 run in ONE worker session so red-state evidence provably
precedes green; splitting them across workers breaks the evidence chain.** The
worker maps every AC to a unit, integration, or browser check, writes tests
first, executes the exact focused command, and records the failing assertion.
Only then may it write the smallest production/config/doc change needed for
green. Green-only evidence is invalid.

## 5. Browser validation — implementing worker

When the change is user-visible, the implementing worker runs the main,
negative, responsive, and accessibility scenarios. It reports screenshots,
console/network failures, and coverage gaps. It never commits screenshots.
For non-UI work, record why browser validation is not applicable.

## 6. Dual adversarial review — reviewer workers and author

After the first green state, build one review-input file containing only:

1. issue text;
2. acceptance criteria;
3. test plan; and
4. the proposed diff.

Dispatch `reviewer_sol` and `reviewer_opus` in the **same turn** so the reviews
run in parallel. Neither prompt may contain the other's findings. Each prompt
receives the review-input file **referenced by path**, never pasted inline;
large multiline pastes are unreliable, and the antigravity TUI in particular
drops them. Both sessions must be fresh and read-only.

Use this brief verbatim for both:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Reviewer A (`reviewer_sol`) attacks correctness, edge cases, test adequacy, and
spec conformance. Reviewer B (`reviewer_opus`) attacks architecture, blast
radius, coupling, and adjacent subsystems.

The implementing worker (the author) reconciles deduplicated findings; the
orchestrator never edits the diff. Every finding is fixed or deferred with a
stated reason. Update the review-input file and return it to both reviewers.
Repeat until both reviewers have reviewed the final diff and no finding is
undisposed.

If Sol is throttled, launch the read-only `reviewer_sol` worker in a fresh
context with an explicit `gpt-5.6-terra` fallback model. If Opus is throttled,
launch a second fresh `reviewer_sol` context and explicitly assign Reviewer B's
architecture/blast-radius focus. Never use the writable implementer configs for
review. The same-vendor fallback must be ANNOUNCED before dispatch. Stamp the PR
and handoff `reviewed without vendor independence` only when Opus falls back to
Sol and both reviewers are on OpenAI. A Terra Reviewer A plus Opus Reviewer B
still spans vendors, so announce that model downgrade without the stamp. Never
apply a fallback silently. If two read-only reviewers cannot run, stop before
handoff or publication. Use Gemini only as a tiebreak after its harness passes
a smoke test. Until then, escalate surviving disagreement to the human.

## 7. Validation — orchestrator

Validation gates **run serially**. Concurrent `bun run validate` processes
starve the machine and produce false Playwright end-to-end failures. Run focused
checks while iterating, then the root guide's aggregate gates in order. If a
Playwright spec fails, re-run that suspect spec alone before blaming the diff;
PGlite `beforeEach` timeouts can also flake under load.

After review fixes and the reviewers' final pass, rerun the affected focused
checks and all gates required by root `AGENTS.md`.

## 8. Commit and draft PR — implementing worker

Phase 8 is done by the **IMPLEMENTING worker, never the orchestrator**, so
provenance resolves to the real contributor identity. Stop on any mismatch and
retain complete output for:

1. `bun run commit:preflight`;
2. a small Conventional Commit created with `git commit -S`;
3. `git verify-commit <commit>` or `git log --show-signature -1`;
4. push of only the issue branch;
5. `gh pr create --draft --base main --body-file <path>`; and
6. `bun run commit:provenance --github <PR>` after obtaining credentials
   without printing the token.

The worker fills the repository PR template, includes `Closes #<issue>`, and
adds the AC-to-evidence table. It never uses `--no-verify`, substitutes a
maintainer identity, marks the PR ready, force-pushes, or merges. The
orchestrator may assemble the PR body and verify provenance afterward, but it
never authors the commit.

## 9. Publication boundary — orchestrator

Confirm the PR is still a draft, targets the intended base, points at the
expected branch and signed head, and carries any degraded-review stamp. Verify
the reported GitHub-resolved author and signature result.
The orchestrator never merges; it leaves the draft for the human.

## 10. Acceptance evidence — orchestrator

Report the branch, worktree, commits, draft PR URL, diff stat, RED command and
assertion, GREEN command, all gate commands and exit statuses, complete
preflight and signature evidence, GitHub provenance result, review dispositions,
and every deviation or unmet AC. Finish with an AC-to-evidence table that a
tester can follow without prior session context.
