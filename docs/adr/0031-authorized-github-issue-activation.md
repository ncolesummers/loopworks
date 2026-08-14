# ADR 0031: Authorized GitHub Issue Activation

Status: Proposed
Date: 2026-08-13

Driving issue: [#256](https://github.com/ncolesummers/loopworks/issues/256)

## Context

A valid GitHub webhook signature proves that GitHub delivered a payload. It
does not prove that the signed sender may start repository compute or that the
delivered action made an issue executable. Final-state-only evaluation allowed
an outsider to open a template-ready issue, reopen or edit an already-ready
issue, or add an unrelated label while model-readable issue content reached run
construction.

GitHub exposes the sender's calculated repository permission through an
installation-token-compatible endpoint requiring Metadata read permission:
[Get repository permissions for a user](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user).
Its legacy `permission` field maps triage to read and maintain to write, while
`role_name` preserves those standard role names and custom roles.

## Decision

At verified webhook ingress, normalize a bounded activation envelope before
any model-readable issue content is used. The envelope contains the action,
action-specific label or milestone evidence, sender ID/login, repository
ID/full name, installation ID, issue number, and only the readiness inputs
needed for deterministic evaluation. It excludes issue title/body, raw payload,
credentials, tokens, and provider responses.

The applicable shipped loop manifest is the sole action allowlist. The runtime
implements exact evaluators for `opened`, `reopened`, `labeled`, and
`milestoned`; `edited` is schema-valid but absent from the shipped manifests.
A manifest-declared action without an evaluator produces `manifest_drift` and
no permission lookup or run. Registered-loop runtime wiring remains separate
scope.

Each evaluator proves a not-ready to ready transition:

1. `opened`: nonexistent issue to the current open issue.
2. `reopened`: closed issue to the current open issue.
3. `labeled`: current labels without the delivered configured ready label to
   current labels.
4. `milestoned`: no milestone to the matching delivered/current milestone.

Before permission lookup, bind the signed repository ID/full name and
installation ID to one active tracked repository. Resolve the signed sender
with the installation-authenticated collaborator-permission endpoint. Standard
triage, write, maintain, and admin roles are authorized. A custom role is
authorized only when the returned legacy base permission is unambiguously
write or admin. Below-triage permission is unauthorized. Missing bindings,
identity mismatch, malformed responses, HTTP errors, rate limiting, and network
failures are indeterminate.

A 503 makes the durable delivery reclaimable by an explicit redelivery; it does
not claim GitHub will retry automatically. Operators must use GitHub's manual or
API redelivery within its retention window after permission service recovery.
An automated redelivery scheduler is an operational follow-up outside this
ingress authorization change. See
[Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).

There is no service-actor exception. Any future exception requires an exact
immutable actor-ID, repository-ID, and installation-ID tuple plus its own
reviewed policy change.

Authorized exact transitions create or correlate at most one run and return
202. Unauthorized, ignored, and manifest-drift decisions persist bounded audit
evidence, create no run, and return 202. Indeterminate decisions persist failed,
reclaimable delivery evidence, create no run, and return 503. Delivery replay
and active repository/issue guards remain authoritative for same- and
distinct-delivery concurrency.

Delivery and lock audit metadata records actor, permission decision, exact
transition, delivery/repository/installation binding, outcome, and a
created-or-existing run ID when one exists. OTel logs, the
`loopworks.webhook.outcome` metric, and active spans use only the bounded
outcomes `authorized`, `unauthorized`, `indeterminate`, `duplicate`,
`manifest_drift`, `ignored`, `invalid_signature`, and `error`.

## Consequences

Issue activation now incurs one tracked-repository read and one GitHub
permission read before run construction. A transient provider or binding
failure delays work through retryable delivery failure rather than guessing.
Audit evidence is sufficient to explain authorization without storing content
that could enter a model or leak credentials.

Shipped manifest actions and runtime evaluators must change together. Adding an
action to the schema alone cannot widen intake authority, and adding it to a
manifest without an evaluator is observable drift.

## Validation

- Authorization unit tests cover hostile transitions, exact label/milestone
  transitions, manifest drift, permission roles/failures, identity binding, and
  the empty service-exception policy.
- The default Octokit permission client is exercised through MSW with no live
  network access.
- PGlite route tests cover durable authorized, unauthorized, indeterminate,
  duplicate, and concurrent-delivery evidence with raw-content exclusion.
- The native PostgreSQL dispatch lane retains independent-session issue-guard
  serialization proof.
- Focused observability, manifest, fixture, and webhook tests plus
  `bun run validate` and `bun run build` are required before publication.

## Follow-Ups

- Registered loop definitions may replace shipped manifest selection only after
  their runtime activation and migration contract is implemented and reviewed.
- A service actor remains subject to ordinary repository permission resolution
  unless a later ADR defines and tests an exact immutable exception tuple.
- Automating failed-delivery discovery and redelivery remains separate from the
  bounded reclaim contract introduced here.
