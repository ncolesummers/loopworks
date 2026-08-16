---
name: orchestrate-issue-pr
description: Orchestrate one LoopWorks issue through managed TDD, independent review, serial gates, a signed commit, and a draft pull request.
metadata:
  loopworks-skill-class: ORCHESTRATION
---

# Orchestrate Issue PR

Single PR only. This managed workflow does not support dependent pull-request
layers. Stop and hand the request back when the issue requires that shape.

The orchestrator owns sequence and handoffs. Workers can discover the canonical
craft skills; each dispatch names the craft required for its current phase,
while policy denies full orchestration workflows. Root and directory
`AGENTS.md` files remain authoritative.

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
input artifact, output artifact, command status, and timestamp. Record a
chronological entry after every phase transition. The ledger is workflow
evidence, not a write-protected integrity boundary. A resumed run reads the
ledger before acting.

## Sequence

| Phase | Owner | Required result |
| --- | --- | --- |
| 0 | Orchestrator | authorization and one-PR shape |
| 1 | Orchestrator | effective cwd proven to be the intended issue worktree |
| 2 | Orchestrator | issue, comments, guides, ADRs, numbered ACs |
| 3–4 | One implementing session | test plan, genuine red, minimal green, review packet |
| 5 | Implementing session | browser evidence or explicit non-UI disposition |
| 6 | Two reviewers, author, then human operator arbiter | bounded reconciliation or recorded human decision |
| 7 | Orchestrator | required repository gates, run serially |
| 8 | Implementing session | preflight, signed commit, push, draft PR, provenance |
| 9 | Orchestrator | draft/base/head verification and durable evidence comment |
| 10 | Orchestrator | AC-to-evidence handoff and all gaps |

### Intake and isolation

Confirm publication authority and one-PR shape. No tested bundle mechanism
confines or relocates a child to a sibling worktree. Require the bundle itself
to have been launched from the intended out-of-main-checkout issue worktree.
The unsandboxed orchestrator self-checks effective cwd, branch, and worktree
registration. If any differ, stop and ask the operator to relaunch from the
worktree; do not dispatch an implementer.

Before dispatch, bootstrap the issue worktree. A fresh worktree has no
`node_modules`; run `bun install`. Securely copy any required `.env.local` from
the main checkout without printing its contents. Keep the worktree outside the
main checkout because `security:osv` honors gitignore and reports no package
sources for an in-repository ignored worktree. Missing dependencies or
environment are bootstrap failures, never valid red-test evidence.

### Acceptance contract

Read the issue and comments, root guide, nearest scoped guides, and relevant
ADRs. Extract numbered acceptance criteria and identify conflicts. Write the
contract to `.polly/review-packet/contract.md` and record the transition.

### Test plan and implementation

Dispatch one implementing worker with the canonical `tdd-implement` craft and
keep that phase in one conversation. Require its complete output in
`.polly/review-packet/impl.md`, then record the transition. Do not restate or
weaken the craft contract here.

### Browser validation

When user-visible, continue the implementing session with the canonical
`browser-validate` craft and require its complete evidence. Otherwise record
why it is not applicable. Do not maintain a second browser-case list here.

### Independent review

Dispatch `reviewer_sol` and `reviewer_opus` in fresh contexts in the same turn.
Each receives only the path to the review packet and this brief:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Write the independent outputs to `.polly/review-packet/reviewer-a.md` and
`.polly/review-packet/reviewer-b.md`; neither reviewer receives the other's
output. Dedupe findings and return them to the authoring worker.
Follow the root `AGENTS.md` reconciliation loop without a separate round cap.
One assessment is one reviewer's examination of one diff state; one
reconciliation round is the author's disposition or revision followed by both
original reviewers' assessments. Divergence means a contradiction on the same
finding: one reviewer keeps it blocking while the other explicitly holds that
same finding non-blocking or invalid. Different findings from disjoint scopes
are not divergence. For a same-finding contradiction, an author dispute, or an
undisposed finding, stop dispatching and report to the human operator in normal
output with the finding and both positions. Publication remains blocked pending
the recorded human decision.

Record the actual author, Reviewer A, and Reviewer B models and providers, plus
whether either reviewer shared the author's model lineage. Put that factual
record in every PR body and final handoff. Announce model fallback before use.
If both reviewers share the author's model lineage, stop: publication remains
blocked without explicit operator authorization for that degraded topology.

### Serial gates

Run focused checks while iterating, then the root guide's aggregate validation.
Never run two repository gates concurrently. Re-run an isolated Playwright
failure before attributing it to the diff.

### Publication

Continue the authoring worker with the canonical `commit-signed-pr` craft and
require its complete evidence. The orchestrator verifies the result but never
authors a commit. No actor marks ready or merges. The CEL command pattern is
only a best-effort speed bump; external repository controls remain the durable
gap recorded in the ADR.

After the PR exists, build one labeled evidence file containing
`.polly/workflow-state.md`, `.polly/review-packet/reviewer-a.md`, and
`.polly/review-packet/reviewer-b.md`, then publish it with
`gh pr comment --body-file <evidence-file>`. Record and verify the comment URL.
Exclude secrets, raw prompts, and unrelated scratch. The ignored `.polly/` tree
is transient local scratch; publication remains blocked if the durable PR
comment cannot be created.

### Handoff

Report branch, worktree, commit, draft PR URL, diff stat, red and green
commands, serial gate statuses, preflight, local signature, GitHub provenance,
reviewer-model lineage record, per-finding disposition, and an AC-to-evidence
table. Include the durable evidence comment URL. State every blocked or
downgraded claim explicitly.
