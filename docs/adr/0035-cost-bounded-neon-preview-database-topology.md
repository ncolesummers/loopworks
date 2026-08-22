# ADR 0035: Cost-Bounded Neon Preview Database Topology

Status: Proposed
Date: 2026-08-21
Issue: [#285](https://github.com/ncolesummers/loopworks/issues/285)
Supersedes: [0018](0018-vercel-managed-neon-deployment-migrations.md)

## Context

Preview deployment retention and Neon branch retention were different lifecycle
controls. On 2026-08-21, a sanitized inventory contained 98 Neon branches: 97
Vercel-created and one Production `main`; 60 were ready and 38 archived. Every
compute was idle or suspended, while aggregate recorded usage was approximately
22.5 CU-hours. The user observed a $50 bill.

The evidence supports, but does not prove from an invoice, branch-hour
attribution: Vercel retained deployments, Neon archived rather than deleted
derived branches, and archiving did not bound the billable branch count. The
$50 attribution remains an evidence-backed inference pending confirmation with
invoice metrics; no savings or causal allocation is claimed here.

The branch fleet also conflicts with #259. Replacing the pre-production
migration journal requires an authorized reset of every disposable database.
Its Preview target must be stable, identifiable, and isolated from Production
before that reset window can be scheduled.

## Decision

1. Keep Neon as the hosted Postgres provider. Production keeps its current
   Vercel integration-owned pooled `DATABASE_URL` and direct
   `DATABASE_URL_UNPOOLED`; local development remains local Postgres.
2. Create one fixed, disposable Preview **root** database in a separate Neon
   project. It must never be a child branch of Production and receives no copied
   Production data. Preview manually owns its pooled runtime URL and direct
   migration URL in Vercel.
3. Preview also owns a distinct `LOOPWORKS_EXPECTED_STORE_ID`. Its value and
   both URLs are required by the target-declaring Preview environment writer.
   Before every ordinary Preview migration, the migration runner reads the
   target database's existing `store_identity` row and requires an exact match
   with that expected value. This database-sourced check is independent of
   self-attested URL configuration and fails closed, before the advisory lock
   or migration, for missing, malformed, unreadable, unprovisioned, or
   mismatched identity without exposing connection strings or identifiers. A
   reviewed, checked-in SHA-256 fingerprint of Production's identity also
   rejects a copied Production expected identity before Preview opens a
   connection; the raw Production UUID is not stored in the repository.
   Application code has no safe way to distinguish a blank Preview root from a
   blank Production target. Initial schema application is therefore a separate,
   explicitly authorized Neon project-and-root-scoped cutover operation, before
   the Preview URLs or expected identity are installed in Vercel. Provision the
   resulting identity, install the three Preview database-target values and
   Preview-only lease token, and only then allow
   ordinary Preview deployments to migrate.
4. Retain the active deployment mechanics from ADR 0018: pooled runtime access,
   direct migrations, migration-before-build, database advisory-lock
   serialization, local Postgres, and the prohibition on seeding hosted stores.
5. All database-changing pull requests must use the `preview:alias` lane for
   alias-bound hosted validation. The label is an exclusive lease, not merely a
   workflow trigger: before alias assignment the workflow fails closed unless
   exactly one open pull request holds it, and the holder retains it through
   browser and data evidence. Removing the label releases the lease. Vercel
   creates builds before this GitHub workflow can run. The Preview build
   independently queries its live pull request files and labels before
   `db:migrate`; it uses a least-privilege Preview-only GitHub token and a
   database-changing pull request must be the sole label holder at the exact
   documented `VERCEL_GIT_COMMIT_SHA` or it cannot connect to Postgres. It
   rechecks the PR head after file classification and in the final holder list.
   A Preview deployment without a PR ID, and a PR with no database-sensitive
   paths after exact-head classification, is build-only and opens no Postgres
   connection. The retained database advisory lock still serializes migrations
   after admission. After Vercel reports READY, alias
   assignment rechecks the live lease, label, and exact PR head immediately
   before mutating the alias, and selects only a READY deployment with the
   exact PR number and commit metadata so a pre-PR build cannot become
   database-validation evidence.
   A read-only provider inspection on 2026-08-22 found `meta.githubPrId` and
   the exact commit metadata on a reviewed Preview deployment, and v6 listing
   pagination exposes an epoch cursor. This is a provider contract: aliasing
   fails closed if Vercel stops exposing that PR metadata.
   The label remains opt-in for changes that do not require alias-bound
   validation.

## Rejected Alternatives

- **Share Production.** This has unacceptable data, schema, and migration risk.
- **Use a Production child branch.** It carries Production lineage and can copy
  data or identity, weakening the isolation this decision requires.
- **Disable database-backed previews.** It removes important hosted migration
  and integration evidence instead of managing its cost.
- **Rely only on retention cleanup.** It cannot prove deletion or cap the
  branch count while Vercel and Neon lifecycles differ.

## Consequences

Cost is bounded to one disposable Preview database and Production isolation is
stronger. The explicit trade-off is cross-pull-request Preview schema and data
interference. `preview:alias` prevents a competing pull request from repointing
the alias during the holder's full hosted-validation window, and the build-time
lease gate prevents an unleased or stale database-changing Preview from reaching
Postgres. This governs trusted, non-fork pull-request code only; arbitrary code
already trusted with Preview credentials is out of scope. Advisory locking
serializes migrations after admission. Manual browser journeys are performed
while the label remains held. Preview must contain no Production data.

This ADR supersedes ADR 0018 in full while preserving its active migration and
connection decisions above. It changes only Preview ownership and lifecycle;
it does not authorize a provider mutation, database reset, legacy-branch
deletion, deployment-retention change, or merge.

## Evidence And Validation

Record credential-free evidence against the following checklist before moving
this ADR to Accepted:

| Evidence | Before (2026-08-21) | After cutover (pending separate authorization) |
| --- | --- | --- |
| Sanitized branch count | 98 total: 97 Vercel-created, 1 Production `main` | 2 total: 1 Production `main`, 1 separate Preview root |
| Branch state | 60 ready, 38 archived; computes idle/suspended | Production and Preview root only; no per-push Neon branch |
| Billing metric | approximately 22.5 aggregate CU-hours; $50 observed bill, attribution unconfirmed | invoice metric and branch-budget evidence, with no causal claim beyond the metric |
| Deployment evidence | Vercel deployments retained while Neon branches archived | representative Preview resolves to the separate project and database-sourced identity; a second push creates no Neon branch |

Automated validation covers Preview-only URL ownership, missing/malformed or
mismatched URL failures without credential leakage, required Preview identity,
and unchanged Production and local behavior. Migration and advisory-lock native
Postgres tests continue to cover direct migration access and serialization.

Operator evidence and commands are in the [Neon deployment runbook](../runbooks/vercel-neon-deployment.md)
and [Preview verification runbook](../runbooks/vercel-preview-verification.md).
Provider behavior and pricing references are [Neon pricing](https://neon.com/pricing),
[manual Vercel connection](https://neon.com/docs/guides/vercel-manual), and
[Vercel deployment retention](https://vercel.com/docs/deployment-retention).

## Follow-Ups

1. After merge authorization, create the separate Preview project/root at the
   minimum scale-to-zero configuration, migrate it, provision its identity, and
   install the three Preview database-target values and Preview-only lease
   token. Disconnect the Production resource from
   Preview and disable per-preview branch creation while preserving Production.
2. After a representative Preview and another Git push prove the fixed target,
   refresh the inventory, preserve Production `main`, and only with explicit
   deletion authority permanently remove the exact legacy Vercel-created
   branches. Configure short Preview deployment retention as defense in depth.
3. Attach the before/after evidence above to #285, then accept this ADR only
   after the live cutover is complete.
4. Do not restore per-preview branching as an undocumented provider toggle. A
   follow-up ADR is required, and may proceed only when monetization or
   sustained concurrent schema work justifies isolation *and* automatic
   deletion, retention limits, branch-budget monitoring, and alerts have been
   proven.
