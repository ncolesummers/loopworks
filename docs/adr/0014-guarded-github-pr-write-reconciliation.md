# ADR 0014: Guarded GitHub PR Write Reconciliation

Status: Proposed
Date: 2026-07-09

Driving issue: [#15](https://github.com/ncolesummers/loopworks/issues/15)

## Context

The development loop needs to turn deterministic validation and reviewed source
changes into a draft GitHub pull request. A GitHub branch, commit, and PR cannot
be committed atomically with Loopworks' Postgres state. Process failure after a
GitHub mutation but before local finalization can otherwise create duplicate or
unattributed writes on retry. A generic approved row is also insufficient: the
bytes written after approval could differ from the evidence a maintainer saw.

## Decision

Loopworks will persist a strict `loopworks.pr_intent.v1` artifact before the
external write. As of issue [#50](https://github.com/ncolesummers/loopworks/issues/50),
the isolated PR-preparer emits `loopworks.pr_preparation_result.v1`; the root
revalidates its evidence bindings and persists its nested PR intent. Live
execution requires a single approved `external-write-review` gate whose
`prChangeDigest` equals the SHA-256 digest of the normalized commit message and
sorted repository-relative file changes and whose `prIntentDigest` equals the
persisted preparation-result digest.
Bypassed, missing, ambiguous, or stale approval does not authorize a PR.
The root binds `prIntentDigest` while that gate is still `requested`; the normal
authenticated approval transition preserves the bound metadata. Preparation
cannot bind an already-resolved gate.

The transition claims both the PR step and approval in a database transaction,
performs the GitHub call outside that transaction with a GitHub App installation
client, then finalizes the step, artifact, run, and `approved` to `applied` audit
event transactionally. Normal approval transitions are rejected while the
external-write claim is active. Failure clears the claim, stores an allowlisted
failure code, and leaves the step retryable.

Each run owns `loopworks/run-{runId}`. Its commit ends with exact run and change
digest trailers. A retry verifies both trailers and the head SHA before reusing
an existing branch or open PR. New PRs are drafts. Development mode uses the
same deterministic intent contract but never constructs a GitHub client or
performs network I/O.

## Consequences

Retries can reconcile the non-atomic provider boundary without creating a
second PR, and approval is bound to the actual bytes requested. A confirmed
GitHub PR may briefly exist before local finalization; the deterministic branch
and trailers make that partial state discoverable and recoverable. Live callers
must provide explicit file changes, a commit message, an authenticated actor,
and an HTTPS Loopworks run link. The later PR-preparation agent may enrich the
intent but cannot mutate GitHub itself.
The PR-preparer has deny-all egress and read-only typed evidence tools. Internal
`artifact://` screenshot references remain audit references; making them
GitHub-renderable requires a separately guarded resolver or upload path.
Durable run links are derived from `LOOPWORKS_PUBLIC_URL` (or Vercel's supplied
project URL) and must exactly match `/runs?run={runId}`; a model-supplied origin
is rejected. Preparation persistence uses a compare-and-set claim so concurrent
conflicting results cannot overwrite one another.

## Validation

1. Contract tests parse V1 intent and reject secret-bearing fields and links.
2. PGlite tests prove validation, predecessor, approval, and digest gates fail
   closed before the writer is called.
3. PR-preparation tests prove exact evidence persistence, idempotent replay,
   conflicting replay rejection, and prepared-intent approval binding.
4. GitHub adapter tests cover new writes, exact branch ownership, existing-PR
   replay, partial-success reconciliation, and unsafe file paths.
5. Failure and retry tests preserve inspectable state and emit ADR 0012 step
   duration and retry metrics through central helpers.
6. Browser tests prove `/runs?run={runId}` opens the linked run detail.

## Follow-Ups

1. Issue #16 audits this path, GitHub App permissions, and remaining bypasses.
2. **Done by issue #50.** Typed authored narrative and validation-owned
   screenshot references enrich the intent without changing the guarded writer
   boundary.
3. Define a richer persisted patch artifact if upstream implementation agents
   need to hand off file changes without an in-process typed payload.
