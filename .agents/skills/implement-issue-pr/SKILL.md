---
name: implement-issue-pr
description: Implement a numbered GitHub issue in an isolated LoopWorks worktree, validate it, create a signed commit, and publish a draft pull request.
---

# Implement Issue PR

Use this human-facing composer when the user authorizes a branch, signed commit,
push, and draft pull request. Default to one pull request; use the repository's
separate stack guidance only when the user explicitly authorizes that shape.

## Worktree preparation

Create or validate the issue worktree in a sibling directory outside the
repository, using `../loopworks-worktrees/<issue>-<slug>`. Never put it under
the repository or `.claude/worktrees/`: in-repository worktree paths are
gitignored, and `security:osv` honors gitignore. From such a path it reports
`No package sources found`, so `validate` fails and no commit can pass.

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main
git worktree list
git worktree prune
git worktree add -b "<type>/<issue>-<slug>" \
  "../loopworks-worktrees/<issue>-<slug>" origin/main
cd "../loopworks-worktrees/<issue>-<slug>"
bun install
```

Replace every placeholder before execution; placeholders are not shell syntax.
Use the repository's established branch type (`agent`, `feat`, `fix`, `docs`,
or `chore`) that matches the issue.

Run worktree creation from the main repository root so the relative sibling
path resolves where intended. A fresh worktree has neither `node_modules` nor
the main checkout's untracked environment files. Run `bun install`, then copy
the required `.env.local` or other required env files from the main checkout
without printing their contents before attempting the first red test. Stop if
the branch or target path already exists rather than reusing or deleting it.

1. Read the issue and comments, choose the authorized PR shape, create or
   validate the prepared sibling issue worktree, and read root/scoped guides
   and ADRs.
2. Use `tdd-implement` for the test plan and continuous red-to-green change.
3. Use `browser-validate` when the change is user-visible.
4. Follow the root guide's independent review contract and resolve every
   finding against the final diff.
5. Run the required focused and aggregate validation gates serially.
6. Use `commit-signed-pr` for preflight, the signed commit, local signature
   verification, branch push, draft PR, and GitHub provenance.
7. Report branch, worktree, commit, PR URL, complete evidence, findings
   dispositions, and the AC-to-evidence table. Never merge or mark ready.

## Managed mode

When an external orchestrator delegates only one stage, do only the bounded
craft named in its dispatch. Do not run the root review stage, create another
agent layer, stamp review claims, merge, or continue to another stage. Write
the issue, ACs, test plan, red/green evidence, and diff to the requested
`.polly/review-packet/` file, append completion to
`.polly/workflow-state.md`, and return the packet path to the orchestrator.
