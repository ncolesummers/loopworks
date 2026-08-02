---
name: implement-issue
description: Implement a GitHub issue end to end under the LoopWorks TDD workflow. Use when asked to implement, build, or fix a numbered issue or issue URL, and for the AC extraction, test-plan-first, adversarial review, and acceptance-evidence steps that work requires.
---

# Implement Issue

Issue-backed implementation workflow. `AGENTS.md` and the nearest scoped guide
still govern code, docs, ADR, observability, and validation expectations — this
skill covers only the procedure layered on top of them.

Invoke as `/implement-issue <issue>` in Claude Code or `$implement-issue
<issue>` in Codex. The issue number or URL arrives as ordinary prompt context —
there is no argument substitution. If no issue was named, ask for one before
doing anything else.

## Guardrails

These are not boilerplate. They hold for the entire run:

1. Never create, switch, rebase, or clean branches. If the current branch is
   unsuitable for this issue, stop and say so.
2. No commits, pushes, or PRs unless explicitly asked.
3. No unrelated refactors. Fix what the ACs require and nothing else.
4. Preserve user work already in the tree.

## Steps

### 1. Resolve

Read the issue (`gh issue view <n> --comments`). Extract acceptance criteria as
an explicit numbered list. Flag any AC that is missing, ambiguous, or conflicts
with another AC or with an ADR — flag it, do not silently resolve it. Read the
nearest `AGENTS.md` for every directory you expect to touch.

### 2. Test plan, before any implementation code

Map every AC to a specific test: unit, integration, or browser. For anything
user-visible add negative, responsive, and accessibility cases.

Reuse an existing test plan or documented journey if one covers the surface. If
none exists and the change is user-visible, explore the running app with the
`agent-browser` skill first.

For an AC that cannot be tested, say why and give the closest deterministic
check. Present the plan before writing implementation code.

### 3. TDD

Per test: run it red first, recording the exact command and the failing
assertion, then make the smallest change that turns it green. Show the red. A
green-only report is not evidence.

### 4. Adversarial review

For non-trivial changes, run the adversarial review below after the first green,
then resolve findings and re-run focused checks.

### 5. Validate and pause

Focused checks while working; `bun run validate` before handing back. Then stop
and report — do not commit.

## Browser validation

Required when the change is user-visible. Run the plan's browser cases with the
`agent-browser` skill: main path, negative, responsive, accessibility.

Prefer a read-only subagent. If running in the main session, say so.

Screenshot meaningful states to a temp path. Report pass/fail, screenshot
paths, console and network errors, and coverage gaps. Never commit screenshots;
attach them to the PR instead (`drogers0/gh-image` is installed). If blocked,
report the blocker and the closest verification you did complete.

## Subagents

Subagents are read-only and the main agent is the sole writer, unless a subagent
is given a concrete disjoint write scope. Declare each one in a single line:
purpose, scope, artifact.

Exception: the test-plan subagent may start and explore the app with
`agent-browser`. Its only output is the test plan.

## Adversarial review

Two reviewers in parallel, fresh contexts, identical brief. Their inputs are the
issue, the ACs, the test plan, and the diff — never this session's reasoning.

Brief, verbatim:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Dedupe both lists. Fix or defer each finding with a stated reason. Re-run
focused checks, then `bun run validate`.

## Acceptance evidence

Close with an AC-to-evidence table: AC, test or command, expected result. Give
exact repro steps for anything manual. Note deviations and gaps explicitly.

Write it for a tester who has no context beyond the issue.
