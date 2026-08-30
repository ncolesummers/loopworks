---
name: implement-issue-pr
description: Implement a GitHub issue end to end in its own git worktree, then commit and open one or more draft PRs. Use when the request authorizes a branch, commits, or pull requests as well as implementation, or when the work must be isolated from the current checkout. Default to one PR; add gh-stack when the root guide selects dependent stacked PRs. Use implement-issue when the user wants to review before anything is committed.
---

# Implement Issue (worktree → draft PR)

Same TDD workflow as `implement-issue`, with one difference: this variant is
authorized up front to isolate the work in a worktree, commit it, and open a
draft PR or stack of draft PRs. `AGENTS.md` and the nearest scoped guide still
govern code, docs, ADR, observability, and validation expectations. Publication
follows ADR 0026.

This is the issue-to-PR publication route and defaults to one PR. If the root
guide selects dependent stacked PRs, every issue-resolution, test-plan, TDD,
browser-validation, review, validation, and acceptance-evidence requirement in
this skill still applies. Use the repository's `gh-stack` skill and stacked-PR
guide for the layer-by-layer variant described in step 7.

Invoke as `/implement-issue-pr <issue>` in Claude Code or `$implement-issue-pr
<issue>` in Codex. The issue number or URL arrives as ordinary prompt context —
there is no argument substitution. If no issue was named, ask for one before
doing anything else.

## Guardrails

These are not boilerplate. They hold for the entire run:

1. Step 1 is the only step allowed to touch the user's main checkout, and only
   to fetch, prune stale worktree registrations, and add the new worktree.
   Every later step runs inside the worktree you created. Never switch, rebase,
   or reset a branch you did not create, and never delete a worktree you did
   not create.
2. Commit and push only the branch or stack branches created inside this issue
   worktree, and only after step 6 passes. Every PR is a draft; never mark one
   ready and never merge it.
3. No unrelated refactors. Fix what the ACs require and nothing else.
4. Preserve user work already in the tree.

## Steps

### 1. Isolate

Put the worktree in a sibling directory *outside* the repository, never under
`.claude/worktrees/`. Paths inside the repo are gitignored, and `security:osv`
honours gitignore: run from there and it reports "No package sources found",
which fails `validate` and therefore every commit.

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
git worktree list                     # confirm the target path is free
git worktree prune                    # clears registrations whose path is gone
git worktree add -b "<feature>/<issue_#>-<issue_description>" \
  "../loopworks-worktrees/<issue_#>-<issue_description>" origin/main
cd "../loopworks-worktrees/<issue_#>-<issue_description>"
bun install
```

Substitute the placeholders before running; they are not shell syntax.
`<feature>` is the branch category this repo already uses — `agent` for issue
work an agent drives, otherwise `feat`, `fix`, `docs`, or `chore`.
`<issue_description>` is a short kebab-case slug from the issue title.

Run the commands from the repository root: the path is relative, so running
them inside another worktree puts the new tree somewhere nobody expects. A
worktree starts without `node_modules` or `.env.local`, so run `bun install`
and copy any env file the change needs from the main checkout before running
tests.

If the branch already exists, or the target path is still registered after
`git worktree prune`, stop and say so rather than reusing or removing it.

### 2. Resolve

Read the issue (`gh issue view <n> --comments`). Extract acceptance criteria as
an explicit numbered list. Flag any AC that is missing, ambiguous, or conflicts
with another AC or with an ADR — flag it, do not silently resolve it. Read the
nearest `AGENTS.md` for every directory you expect to touch.

### 3. Test plan, before any implementation code

Map every AC to a specific test: unit, integration, or browser. For anything
user-visible add negative, responsive, and accessibility cases.

Reuse an existing test plan or documented journey if one covers the surface. If
none exists and the change is user-visible, explore the running app with the
`agent-browser` skill first.

For an AC that cannot be tested, say why and give the closest deterministic
check. Present the plan before writing implementation code.

### 4. TDD

Per test: run it red first, recording the exact command and the failing
assertion, then make the smallest change that turns it green. Show the red. A
green-only report is not evidence.

### 5. Adversarial review

Run the universal adversarial review from root `AGENTS.md` after the first
green, then resolve findings and re-run focused checks. One round is the
default; only critical-severity findings can require another round, and the
three-round hard cap always applies. Route actionable out-of-scope findings to
a linked backlog issue instead of extending the implementation. A stack is a
team scheduling primitive: review the first lower layer after its first green,
then review each later layer in dependency context together with the assembled
top-of-stack diff before publishing that layer. Each layer publication is a
new bounded review scope under the root guide's three-round cap.

### 6. Validate

Validate at the level `AGENTS.md` requires for the change you actually made,
escalating only as its Validation section says.

`.pre-commit-config.yaml` runs `bun run precommit` — which is
`commit:preflight` plus the full `validate` chain, Playwright and Storybook
included — on *every* commit, not once per branch. Keep the commit series short
for that reason, and never reach for `--no-verify` to avoid it. Two agents
running `validate` on the same machine starve it and fake e2e failures; if a
Playwright spec fails, re-run that spec alone before believing it.

### 7. Commit and open the draft PR

For one PR, stop on any mismatch:

1. Confirm from the step 6 `commit:preflight` output that the effective author
   and committer are the actual contributor identity represented by the GitHub
   account, not a fixture identity. Retain the complete output as handoff
   evidence.
2. Create small, atomic commits with `git commit -S`, one logical change each,
   in Conventional Commits form (`<type>(<scope>): <subject>`). Each commit
   carries the type of the change it makes — a red-test commit is `test:` even
   on a `feat/` branch. Do not use `--no-verify` or disable signing to work
   around a failed preflight.
3. Inspect the local signature with `git verify-commit <commit>` or
   `git log --show-signature -1` and retain the result as handoff evidence.
4. Write the PR body to a file, filling in `.github/pull_request_template.md`
   with `Closes #<issue_#>` and the acceptance-evidence table, then push and
   open the draft. Do not use `--fill`; it replaces the template with commit
   subjects.

   ```bash
   git push -u origin "<feature>/<issue_#>-<issue_description>"
   gh pr create --draft --base main \
     --title "<type>(<scope>): <subject>" --body-file "$PR_BODY"
   ```

   Push is required before GitHub metadata exists.
5. Obtain the token and repository without printing the token (`export
   GH_TOKEN="$(gh auth token)"` and `export GITHUB_REPOSITORY="$(gh repo view
   --json nameWithOwner --jq .nameWithOwner)"`), then run `bun run
   commit:provenance --github <PR>` against the pushed PR. The GitHub-resolved
   author and verified signer must satisfy the repository policy. No user
   handoff occurs before this verification passes; retain its output as
   handoff evidence.

For a stack, keep steps 1 through 6 and the acceptance-evidence section intact,
but apply them incrementally from bottom to top. Resolve the issue and plan the
whole stack once in steps 2 and 3. Then complete the current layer's TDD,
scoped adversarial review, validation, preflight, signed locally verified
commit, `gh stack submit --auto`, filled PR template, and GitHub provenance
before creating or implementing the next branch. This makes the draft
available for human review while work continues on a later layer. Do not
implement later layers in one combined working tree and split them afterward
unless the user explicitly requires atomic publication.

For each later layer, have both reviewers inspect that layer in dependency
context and the assembled top-of-stack diff under the root guide's bounded
policy. Rerun affected layer checks, keep whole-stack validation at the final
layer, submit the newly eligible draft, and run GitHub provenance for every PR
whose head changed. If feedback changes a published lower layer, fix it on its
own branch after preserving any in-progress upper-layer work. That change starts
a new bounded review scope: cascade-rebase the affected upper layers, restore
the preserved work on the rebased head, rerun relevant checks and signature
verification, return the affected diffs to both reviewers, push, refresh each
affected PR's acceptance-evidence table and review dispositions, and refresh
GitHub provenance.

Report the branch, worktree path, commit list, and PR URL. Leave the worktree
in place for the user; `/clean_gone` removes it and its branch once the branch
is merged and deleted upstream.

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

Follow the universal contract in root `AGENTS.md` after the first green and
before handoff or publication. It applies whether the work stops without a PR,
ships as one PR, or ships as a stack. One round is the default and includes
both independent reviewers. Additional rounds are only for critical-severity
findings from the preceding round. Never exceed three review rounds; an
unresolved in-scope critical finding at the cap blocks handoff or publication.
Record actionable out-of-scope findings in a linked backlog issue; they do not
extend or block the current implementation.

## Acceptance evidence

Close with an AC-to-evidence table: AC, test or command, expected result. Give
exact repro steps for anything manual. Note deviations and gaps explicitly.

Write it for a tester who has no context beyond the issue.
