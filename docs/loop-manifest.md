# Loop Manifest

## Purpose

This document defines the operating contract for Loopworks. It explains how work enters the system, how it moves, and what the portal must preserve for auditability.

## Source of Truth

1. GitHub Issues are the source of truth for backlog intent.
2. GitHub milestones define delivery stages.
3. GitHub labels define type, area, priority, and status.
4. The portal may derive summaries, but it should not become the canonical backlog store.

## Loop Model

Each loop should have:

1. A scope defined by one or more issues.
2. A current state.
3. A history of transitions and external sync events.
4. A visible owner or actor for each important transition.
5. A validation and review outcome before closure.
6. Observability contracts for logs, metrics, traces, artifacts, and correlation identifiers.

## Recommended Loop States

1. Intake
2. Triage
3. Planned
4. In Progress
5. Waiting on Review
6. Validating
7. Blocked
8. Done

## Required Metadata

Every tracked item should carry:

1. Repo context.
2. Milestone.
3. Area label.
4. Priority label.
5. Current state.
6. Last synced timestamp.
7. Source links to issues, PRs, and deployments.

## Manifest Contract

The manifest is versioned. The current schema uses `version: 1` and requires at
least one entry in `loops`.

Each loop definition includes:

1. `key`, `name`, and `description` for stable identification.
2. `enabled` to stop new runs without deleting the loop contract.
3. `repoScope` with allowed repositories, branch patterns, and fork policy.
4. `triggers` with issue labels, blocked labels, issue event states, manual
   trigger support, and optional schedules.
5. `modelPolicy`, `toolPolicy`, and `budgets` to bound agent execution.
6. `approvals` describing high-impact actions, required reviewers, bypass
   policy, and evidence.
7. `artifacts` describing required plans, validation reports, diff summaries,
   PR intents, traces, and retention.
8. `validationGates` with deterministic commands and the rollout phase they
   protect.
9. `retryPolicy` with bounded attempts and backoff.
10. `concurrency` with the group key, max in-flight runs, and cancellation
    behavior for overlapping work.
11. `cancellation` for disabled or superseded work.
12. `githubWriteback` for approved comments, labels, or status checks.

The sample `development-loop` covers the `agent-ready` trigger and the first
durable issue-backed implementation skeleton. The stage sequence is stable:
planning, test-writing, development, validation, code review, commit, PR, and
done. Each stage has a required visible artifact contract:

1. Planning: plan artifact.
2. Test-writing: red test evidence and an automated test plan with explicit
   fixtures and a bounded test-only patch.
3. Development: patch artifact.
4. Validation: validation report and screenshot evidence manifest.
5. Code review: typed validation-review result in the code review notes artifact.
6. Commit: commit intent.
7. PR: PR intent.
8. Done: completion summary.

Validation must appear before code review, commit, PR, and done. Disabled
development-loop triggers must not create a run; they record a durable
skipped/no-op reason such as `loop_disabled` so operators can explain why an
`agent-ready` issue did not start. Research-loop disabled evidence is tracked
separately from the development-loop skeleton.

The planning-to-test-writing boundary requires an `approved` `plan-review`
record tied to the exact run, plan row, and canonical plan digest. The
test-writing stage succeeds only when every approved-plan acceptance criterion
has expected assertion-failure evidence. Its `validation_report` row carries
`loopworks.red_test_evidence.v1`; its `test_plan` row carries
`loopworks.test_plan.v1`. Both remain separate from the later green validation
report. Expected-red entries include a verified execution receipt bound to the
persisted test patch; setup, infrastructure, timeout, crash, unrelated, or
passing outcomes cannot advance the stage.

## Screenshot Evidence And Validation Review

The validation stage classifies a run as UI-affecting when the persisted
production patch touches app, component, or style paths, or when the test plan
contains browser or Storybook coverage. UI-affecting runs must have at least one
persisted browser journey and a `loopworks.screenshot_evidence.v1` manifest with
one PNG capture per browser test at each required viewport: mobile `390x844`,
laptop `1280x832`, and desktop `1440x960`. The manifest is bound to the exact
repository commit, test-plan digest, and production-patch digest. Non-UI runs
persist the same schema with an explicit empty capture set. Missing, duplicate,
forged, stale, or incomplete evidence blocks validation.

Code review begins only after deterministic validation has passed. The isolated
validation-reviewer consumes the persisted plan, test plan, implementation
result, validation report, and screenshot manifest, then emits
`loopworks.validation_review_result.v1`. Findings use bounded severity,
category, path, and line fields and cite exact validation keys and screenshot
capture IDs. Results cannot contain raw command output, prompts, patch bodies,
screenshot bytes, credentials, or secrets. `commit` is invalid with blocker or
high findings; backward routes require cited findings and a non-empty reason.

Only the root transition applies the recommendation. `commit` completes code
review and advances. `development` requeues development, validation, and code
review. `test-writing` also requeues test writing. Cycles reuse existing rows,
increment attempts, clear execution claims, reset invalidated artifact
contracts, retain the approved plan, and record the prior attempt, result
digest, and route for audit and idempotent replay. The manifest retry policy
bounds further backward routing.

## Validation Report Artifact

The `validation_report` artifact uses schema
`loopworks.validation_report.v1`. The report is the structured downstream
contract for deterministic validation results and is consumable without parsing
raw command output.

Each report records:

1. `version: 1`, `schemaId`, `generatedAt`, `overallOutcome`, and aggregate
   pass/fail/skipped counts.
2. One ordered result per manifest validation gate, preserving the manifest
   order.
3. Gate `key`, `name`, `command`, `phase`, `produces`, and `required` fields
   copied from the manifest.
4. The gate outcome (`pass`, `fail`, or `skipped`), exit code when a command
   ran, and duration in milliseconds.
5. A redacted raw-output reference when output is available, including URI,
   SHA-256, stdout/stderr byte counts, and truncation state. Byte counts and
   digests describe the redacted output persisted by the output writer.

Reports must not embed raw stdout, stderr, prompts, tokens, credentials, or
secret-looking fixture values. Run and step status transitions, downstream
blocking, approval-policy continuation, and lifecycle telemetry are handled by
the transition layer rather than by the validation report runner.
Failed validation gates block downstream stages by default. Skipped required
gates also block downstream stages, even when other gates passed; skipped
optional gates remain inspectable in the report but do not block progression.

Queued `validation_report` artifacts may carry
`validationReportMetadataKind: validation_report_contract` with
`expectedValidationReportSchemaId` while waiting for execution. Completed
validation artifacts carry `validationReportMetadataKind:
validation_report_result`, `validationReportSchemaId`, and the parseable V1
report payload.

## PR Intent And Guarded Creation

The isolated PR-preparer emits `loopworks.pr_preparation_result.v1`; the root
revalidates and persists its nested `loopworks.pr_intent.v1`. The strict
versioned payload
contains the deterministic PR title and body, source-issue and run links,
`validation_report.v1` summary and artifact link, ordered safe artifact links,
optional deployment context, and exact validation-owned screenshot references.
It does not accept raw prompts, validation stdout or stderr, arbitrary
artifact metadata, credentials, or credential-bearing URLs. Secret-like text
selected from persisted titles is redacted before composition. Non-UI runs use
an explicit empty screenshot list. `artifact://` screenshot references remain
internal audit references and are not uploaded by the subagent.
The run backlink is canonicalized from `LOOPWORKS_PUBLIC_URL` (or the Vercel
project URL) and must bind the exact run ID. The final validation link is chosen
by the validation artifact's persisted digest, so earlier red evidence cannot
replace it through artifact ordering.

Queued PR artifacts use `pr_intent_contract` metadata with the expected schema
id and version. Completed artifacts use `pr_intent_result` metadata containing
the parseable payload and, for live mode, the confirmed GitHub PR number, URL,
head branch, and head SHA.

Both execution modes use the same transition boundary:

1. Validation must have advanced with every repository-required gate present
   and passing; code review and commit predecessor steps must have succeeded;
   and the root must have persisted an exact typed PR-preparation result.
2. Exactly one `external-write-review` approval must be `approved`. Live mode
   also requires its `prChangeDigest` evidence to match the normalized commit
   message and file bytes exactly. Both modes require `prIntentDigest` to match
   the persisted preparation result; bypassed approvals do not qualify.
   The root adds the intent digest while the approval is still requested, and
   the authenticated approval transition preserves that evidence binding.
3. Development mode persists the artifact without constructing a GitHub client
   or using network and non-loopback services.
4. Live mode uses a GitHub App installation token, creates a deterministic
   `loopworks/run-{runId}` branch and marked commit, and opens a draft PR.
5. An active approval carries a short-lived write claim so ordinary approval
   transitions cannot race the GitHub mutation. The approval becomes `applied`
   only after GitHub confirmation and durable finalization.
6. Provider failures store only typed failure codes, leave the PR step failed
   and inspectable, and reuse the existing retry transition. Replays verify the
   run and change markers before reconciling an existing branch or PR.

GitHub writes occur outside the database transaction. The deterministic branch,
commit trailers, change digest, and existing-PR lookup are the reconciliation
key if the process stops between provider success and local finalization. See
[ADR 0014](adr/0014-guarded-github-pr-write-reconciliation.md).

## Operating Rules

1. Do not advance a loop without recording why the state changed.
2. Do not hide blocked work; expose blockers directly in the UI.
3. Keep one issue as the smallest durable planning unit.
4. Use comments and labels for lightweight coordination, not separate shadow trackers.
5. Preserve enough history to reconstruct what happened after the fact.
6. Emit structured logs for trigger decisions, validation gates, retries, cancellations, approvals, and external writes.
7. Store durable records for audit state; do not rely on logs as the only source of truth.

## Change Governance

Manifest changes must be reviewable before rollout:

1. Propose the manifest as a diff in the issue or PR that changes loop
   behavior. GitHub remains the durable planning surface.
2. Validate the proposed manifest with the TypeScript schema and the checked-in
   JSON schema. Invalid manifests must report field paths, messages, and hints.
3. Add or update deterministic tests for changed triggers, enabled state,
   validation gates, approvals, retries, concurrency, or cancellation behavior.
4. Add eval coverage when model policy, prompt/tool access, or workflow behavior
   changes in a way deterministic tests cannot fully judge.
5. Require PR review for any change that expands write access, changes approval
   gates, loosens validation, raises budgets, changes concurrency, or changes
   GitHub writeback behavior.
6. Record rollout notes that identify the manifest version, affected loop keys,
   validation evidence, reviewer approval, and rollback or disable path.

## Milestone Contract

### M0 Project Foundation

Define the operational baseline, repo conventions, docs, and data model.
Persona test IDs: P01, P03, R02, S04.

### M1 Design System Direction + App Shell

Establish the UI vocabulary before the app becomes too broad.
Persona test IDs: P01, P04, M01, A02, R02.

### M2 GitHub + Vercel Source Systems

Wire the external systems that supply truth about work and deployment state.
Persona test IDs: P02, M01, M03, R01, S01, S02, S03.

### M3 Durable Loop MVP

Ship the first end-to-end loop with persisted history.
Persona test IDs: M02, A01, A02, A03, R01.

### M4 Validation + PR Path + MVP Security Review

Add release confidence, review visibility, and security signoff.
Persona test IDs: A03, R01, R02, S01, S02, S03, S04.

### M5 Agent Governance + Evals

Add guardrails and scenario coverage for agent behavior.
Persona test IDs: P03, A02, A03, R02, S04.
