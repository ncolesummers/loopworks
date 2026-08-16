---
name: implement-issue-pr
description: Orchestrate one LoopWorks issue through managed TDD, independent review, serial gates, a signed commit, and a draft pull request.
---

# Implement Issue PR

Single PR only. This managed workflow does not support dependent pull-request
layers. Stop and hand the request back when the issue requires that shape.

The orchestrator owns sequence and handoffs. Workers receive phase-scoped craft
only. Root and directory `AGENTS.md` files remain authoritative.

## Dispatch envelope

Every `args.input` must begin with this block, filled with the current state:

```text
ROLE:        <implementer | browser validator | reviewer A | reviewer B | publisher>
PHASE:       <n or n-m> of 10 (<short name>)
DONE:        <completed phases> [see .polly/workflow-state.md]
YOU PRODUCE: <one bounded artifact>
YOU DO NOT:  run another phase, spawn subagents, stamp review claims, or merge
NEXT:        <owner and next gate>
```

Put the bounded task after the block. Do not paste a multiline diff into
`args.input`; pass its handoff-file path.

## Workflow ledger

Create `.polly/workflow-state.md` in the issue worktree before the first
dispatch. Record issue, worktree, branch, intended PR, phase owner, session id,
input artifact, output artifact, command status, and timestamp. Both
orchestrator and worker append after every phase transition. Never rewrite or
delete prior entries. A resumed run reads the ledger before acting.

## Sequence

| Phase | Owner | Required result |
| --- | --- | --- |
| 0 | Orchestrator | authorization and one-PR shape |
| 1 | Orchestrator | effective cwd proven to be the intended issue worktree |
| 2 | Orchestrator | issue, comments, guides, ADRs, numbered ACs |
| 3–4 | One implementing session | test plan, genuine red, minimal green, review packet |
| 5 | Implementing session | browser evidence or explicit non-UI disposition |
| 6 | Two reviewer sessions, then author | independent findings and author disposition |
| 7 | Orchestrator | required repository gates, run serially |
| 8 | Implementing session | preflight, signed commit, push, draft PR, provenance |
| 9 | Orchestrator | draft/base/head/publication-boundary verification |
| 10 | Orchestrator | AC-to-evidence handoff and all gaps |

### Intake and isolation

Confirm publication authority and one-PR shape. Omnigent makes the runner launch
workspace authoritative for child sessions, so a worker `os_env.cwd` cannot
redirect a child into a sibling worktree. Require the bundle itself to have
been launched from the intended out-of-main-checkout issue worktree. Verify
effective cwd, branch, and worktree registration. If any differ, stop and ask
the operator to relaunch from the worktree; do not dispatch an implementer.

### Acceptance contract

Read the issue and comments, root guide, nearest scoped guides, and relevant
ADRs. Extract numbered acceptance criteria and identify conflicts. Write the
contract to `.polly/review-packet/contract.md` and append the transition.

### Test plan and implementation

Dispatch one implementing worker with the `tdd-implement` craft. Keep planning,
test creation, the exact red run, and the minimal green change in that same
conversation. The worker writes `.polly/review-packet/impl.md` containing issue,
ACs, test plan, red evidence, and diff, then appends its completion to the
ledger. Green-only evidence is invalid.

### Browser validation

When user-visible, continue the implementing session with the
`browser-validate` craft. Require main, negative, responsive, accessibility,
console, and network evidence. Otherwise append why it is not applicable.

### Independent review

Dispatch `reviewer_sol` and `reviewer_opus` in fresh contexts in the same turn.
Each receives only the path to the review packet and this brief:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Neither receives the other's output. Dedupe findings and return them to the
authoring worker for test-backed fixes or stated deferrals. Refresh the packet
and return it to both original reviewers until both have assessed the final
diff and every finding is disposed.

Record the actual author, Reviewer A, and Reviewer B models and providers, plus
whether either reviewer shared the author's model lineage. Put that factual
record in every PR body and final handoff. Announce model fallback before use.

### Serial gates

Run focused checks while iterating, then the root guide's aggregate validation.
Never run two repository gates concurrently. Re-run an isolated Playwright
failure before attributing it to the diff.

### Publication

Continue the authoring worker with `commit-signed-pr`. The author runs complete
preflight, commits with `-S`, verifies the local signature, pushes only the
issue branch, updates or creates the draft PR from the repository template, and
runs GitHub provenance. The orchestrator verifies the result but never authors
a commit. No actor marks ready or merges; CEL denies merge commands.

### Handoff

Report branch, worktree, commit, draft PR URL, diff stat, red and green
commands, serial gate statuses, preflight, local signature, GitHub provenance,
reviewer-model lineage record, per-finding disposition, and an AC-to-evidence
table. State every blocked or downgraded claim explicitly.
