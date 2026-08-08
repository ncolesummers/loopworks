# ADR 0023: Self-Improving Loops And Approved Memory

Status: Proposed
Date: 2026-08-07
Driving issue: [#161](https://github.com/ncolesummers/loopworks/issues/161)

## Context

Loopworks records durable evidence about development-loop runs, including
steps, retries, backward routes, approvals, validation results, terminal
reasons, duration, and model cost. That evidence currently supports operator
inspection but does not inform later runs. The system has a governance gate for
agent changes, but no learning path that can preserve a lesson from one run and
make it available to the next.

Closing that feedback loop introduces a more serious failure mode than losing a
recommendation: memory poisoning. A lesson can be wrong when proposed, become
wrong as a repository changes, or be applied outside the context that produced
it. An unreviewed or stale lesson injected into every later run would degrade
the system continuously and quietly. Provenance, scope, supersession, decay,
and human approval are therefore part of the initial architecture rather than
later hardening.

The first self-improvement milestone needs three durable concepts with separate
owners: an exact outcome ledger, an agent-authored retrospective, and approved
learned memory. It also needs an explicit boundary on what the system may
change autonomously.

## Decision

### Outcome ledger

The control plane owns one outcome-ledger row for each finalized run. It derives
the row deterministically from existing run steps, loop events, observability
events, approvals, and approval transition events after the run's terminal
state is durable. The rollup includes stage retries and reasons, backward routes
by target stage, approval rejections by gate, stage duration and model cost,
validation failures by command, and the terminal reason.

No agent contributes judgment to the ledger. Transition sites continue writing
their existing source records and do not gain duplicate outcome writes. If
ledger computation fails, the failure is recorded for retry and reconciliation;
it cannot block finalization or change the terminal result of the run it
describes. Creating or reconciling a missing ledger durably dispatches its
retrospective through an outbox intent inserted in the same transaction as the
ledger. The intent has a unique run-and-ledger-revision key, and its consumer
persists artifacts and candidates idempotently against that key. A crash can
therefore neither strand the learning path nor create duplicate retrospectives.

### Retrospective artifact

The retrospector follows ADR 0015 as a declared sibling subagent, not a nested
owner. It runs after any run reaches a durable terminal outcome: after `done`
for a successful run and after finalization for failed, timed-out, stalled, or
canceled runs. It reads the completed outcome ledger, the run's artifacts, and
the exact stage-context manifests described below, then returns a typed
retrospective containing zero or more candidate memories and zero or more
proposed corroborations. A clean run may legitimately produce neither.

The retrospector cannot write durable state, mutate GitHub, approve a memory,
or advance a run stage. The neutral root validates its typed result and owns
all persistence. An error, timeout, or invalid retrospective is recorded as a
learning failure but cannot retroactively fail or alter the completed run.

### Learned memory

Learned memory is repository-scoped control-plane state, with optional stage
scope. It is not a work item or a second backlog. Each memory carries its body,
originating run, cited evidence, scope, canonical content digest, confirmation
and last-corroborated run references, and an optional link to the memory it
supersedes. Its lifecycle is `candidate`, `active`, `superseded`, or `retired`.
Provenance is required before a candidate can exist. A monotonic `reviewEpoch`
identifies each distinct activation or renewal decision for the immutable
memory.

The canonical digest binds the complete behavior-bearing envelope: body,
repository and optional stage scope, origin run and cited evidence,
`supersedesId`, and the activation policy. Body, scope, provenance, and policy
are immutable once proposed. Changing any of them creates a new candidate and
digest, so an approval cannot be reused for broader scope or different evidence.

Supersession is append-only: a replacement receives a new row and digest and
links to the prior memory. The prior row remains traceable as `superseded`;
memory text and provenance are never destructively overwritten.

Candidate memories are inert. A candidate can become `active` only through a
persisted `memory-review` approval. Its canonical review target binds the memory
digest, current `reviewEpoch`, expected status, requested action, and any
corroboration-proposal digest. Applying an approval requires all fields to match,
consumes that approval once, and increments `reviewEpoch`, so an approval from a
prior lease cannot reactivate or renew the memory. Approval and rejection emit
ADR 0011 approval transition audit events with actor, action, time, reason where
applicable, and digest evidence. A rejected candidate becomes `retired`. A
prompt, agent result, model decision, or stale, replayed, or mismatched approval
is never approval.

The approval grants a ten-eligible-run activation lease as part of the digested
policy. Automatic expiry at that bound is therefore an enforcement of the
operator-approved behavior, not new agent authority. Renewing or changing the
lease requires another exact human approval.

At this milestone, what learned information may change agent behavior without
human approval? **Nothing.**

### Corroboration, decay, and re-review

A retrospective may propose corroboration only for a memory listed as injected
in the run's exact stage-context manifest, and it must cite independent evidence
from that run. The proposal receives its own canonical digest binding the memory
digest and review epoch, corroborating run, stage-context manifest digest, and
exact cited evidence. It is stored for operator review but does not update
`lastCorroboratedRunId`, reset decay, or extend activation. Only a one-time
operator approval bound to that exact proposal digest may do so.

A completed run is eligible for the decay horizon only when it happened after
the memory's latest human confirmation, its repository and optional stage match,
and its context manifest proves the memory was considered for injection. Both
injected and budget-omitted memories count, so a low-ranked active memory cannot
remain dormant indefinitely and later reappear under a stale approval.
Retrospective errors, timeouts, and invalid results are visible as unavailable
corroboration evidence but still advance the operator-approved lease; a broken
retrospector cannot silently keep memory active forever.

After ten eligible runs without human-confirmed corroboration, the approved
lease expires and the `active` memory is demoted to `candidate`. It immediately
becomes non-injectable and returns to the operator's review queue with its
original provenance, proposed corroborations, and uncorroborated-run evidence
visible. Reapproval of the same digest makes it active and resets the ten-run
horizon; rejection retires it; a replacement supersedes it. This policy prevents
a memory from silently persisting or silently vanishing, and no agent-generated
citation can keep it active.

### Deterministic context budget

Approved memory enters a stage only through the root-owned stage-context read.
Each repository has a validated positive-integer
`learnedMemoryContextTokenBudget` setting, defaulting to 2,000 tokens per stage
context read. The memory-store contract pins and versions the deterministic
token-counting method; provider-reported or runtime-dependent token estimates
cannot decide selection.

The read considers only `active` memories in repository and stage scope. It
orders stage-specific memories before repository-wide memories, then orders by
effective recency descending and stable memory id ascending. Effective recency
is the completion time of the human-confirmed `lastCorroboratedRunId`, falling
back to `confirmedAt`, so a newly approved memory never has ambiguous null
placement. It includes complete memories only and stops before the next memory
would exceed the budget. Returned context states the budget, consumed tokens,
omitted-memory count, and whether truncation occurred.

The root persists the exact ordered considered-memory ids, canonical bodies,
digests, provenance, token counts, and selected or budget-omitted outcome as a
digest-bound stage-context manifest before delegation. That manifest lets the
retrospective evaluate and cite the exact rule a stage actually received, lets
decay account for omitted memories, and avoids inference from prompt text or
downstream artifacts. Identical inputs produce the same manifest and the same
visible truncation result.

### Existing decision relationships

- ADR 0001 remains authoritative: memories are internal control-plane state,
  while GitHub Issues remain the durable planning and backlog surface.
- ADR 0015 governs the retrospector's sibling topology, typed handoff, isolated
  authority, and root-owned persistence.
- ADR 0011 governs the append-only audit events for memory approval and
  rejection transitions.
- ADRs 0003 and 0012 keep logs and operational telemetry separate from durable
  state and own the metric contract. Implementation adds
  `loopworks.run.retries`, `loopworks.run.backward_routes`, and
  `loopworks.run.approval_rejections` through the central observability helpers;
  their instruments and low-cardinality attributes must be added to ADR 0012
  before emission.

## Consequences

Loopworks can learn from completed work without granting an agent authority to
change future behavior. Operators can trace every active lesson to its source,
review its exact content, and see why it returned for re-review. Deterministic
derivation and context selection make the same run evidence reproducible.

The design adds durable state, a post-completion agent stage, approval volume,
and prompt-context cost. Relevant memories can temporarily stop influencing
runs while awaiting re-review, which is intentional: a false negative is safer
than silently retaining a stale instruction. A fixed default budget can omit a
useful low-ranked memory, so truncation must remain visible and the repository
setting can be reviewed deliberately.

Instruction or prompt changes opened as reviewable PRs with eval evidence are
deferred. Synthesizing Eve skills from repeated toil is also deferred. Both
follow-ons depend on the ledger, approved-memory model, and governance boundary
defined here.

## Validation

1. Every terminal run produces one exact outcome-ledger row derived from its
   existing records, including exact retry, backward-route, and approval counts.
2. Retrospective discovery identifies a declared sibling with a typed result
   and no durable-write, GitHub-write, approval, or transition authority.
3. A memory cannot become active without a matching persisted `memory-review`
   approval, and every decision produces an ADR 0011 audit event.
4. Identical active memories, scope, configuration, and corroboration state
   produce identical ordered context and truncation metadata.
5. Ten eligible runs without human-confirmed corroboration expire the approved
   lease and return an active memory to non-injectable candidate review without
   deleting its history; omitted memories and failed retrospectives advance the
   visible lease horizon.
6. Metric names and attributes validate against the amended ADR 0012 contract.

## Follow-Ups

- [#162](https://github.com/ncolesummers/loopworks/issues/162) implements the
  outcome ledger, transactional retrospective outbox, and run-level metrics.
- [#163](https://github.com/ncolesummers/loopworks/issues/163) implements the
  full-envelope digest, review epoch and lease state, provenance, supersession,
  and budgeted reads.
- [#164](https://github.com/ncolesummers/loopworks/issues/164) implements the
  one-time, epoch- and proposal-digest-bound `memory-review` approval gate.
- [#165](https://github.com/ncolesummers/loopworks/issues/165) adds the sibling
  retrospector for every terminal outcome, including typed candidate-memory and
  proposed-corroboration results.
- [#166](https://github.com/ncolesummers/loopworks/issues/166) injects approved
  memories under the deterministic context budget and persists exact considered,
  injected, and omitted stage-context manifests.
- [#167](https://github.com/ncolesummers/loopworks/issues/167) adds the operator
  retrospective, corroboration, lease-expiry, and memory-review surfaces.
- [#168](https://github.com/ncolesummers/loopworks/issues/168) adds retrospective
  eval coverage and governance documentation.
- A later milestone may propose instruction-change PRs with eval evidence and
  synthesize Eve skills from repeated, corroborated toil.
- Before implementation begins, issues #162 through #167 must update their
  bodies and acceptance criteria to carry these contracts. Where their current
  wording is narrower, this ADR is authoritative rather than an invitation to
  omit terminal outcomes, manifests, lease state, or digest bindings.
