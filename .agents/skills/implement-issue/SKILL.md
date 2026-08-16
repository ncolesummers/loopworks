---
name: implement-issue
description: Implement a numbered GitHub issue in the current LoopWorks worktree with TDD and validation, stopping before commit or publication.
metadata:
  loopworks-skill-class: ORCHESTRATION
---

# Implement Issue

Use this human-facing composer for one issue when the user wants to inspect the
result before any commit.

Never create, switch, rebase, or clean branches or worktrees. If the current
branch or worktree is unsuitable, stop and ask the operator to use
`implement-issue-pr`; this paused variant does not alter repository topology.

1. Read the issue and comments, root and scoped guides, and relevant ADRs.
2. Confirm the current worktree and preserve unrelated work.
3. Use `tdd-implement` for the test plan and continuous red-to-green change.
4. Use `browser-validate` when the change is user-visible.
5. Follow the root guide's independent review contract.
6. Resolve every finding, then run the required focused and aggregate gates
   serially.
7. Report the diff, evidence, findings dispositions, and AC-to-evidence table.
   Do not commit, push, or open a pull request.

## Managed mode

When an external orchestrator delegates only one stage, do only the bounded
craft named in its dispatch. Do not run the root review stage, create another
agent layer, stamp review claims, publish, or continue to another stage. Write
the issue, ACs, test plan, red/green evidence, and diff to the requested
`.polly/review-packet/` file, append completion to
`.polly/workflow-state.md`, and return the packet path to the orchestrator.
