# ADR 0006: Deterministic Validation, TDD, Playwright, And Storybook

Status: Accepted
Date: 2026-06-20

## Context

Agentic development can produce convincing summaries that are not reliable evidence. Loopworks needs deterministic checks before LLM judgment, plus a development practice that keeps user-visible workflows and reusable UI components covered as they grow.

## Decision

Loopworks will treat deterministic validation as the first quality gate. The validation order is format, code lint/static analysis, Markdown static analysis, typecheck, unit/integration tests, browser workflow tests, accessibility checks, Lighthouse where relevant, security checks where relevant, and only then LLM review or judgment.

For behavior changes, agents and maintainers should define the test plan before implementation and add or update tests alongside the implementation. Playwright is the browser and user-workflow test runner. Storybook is the component development, documentation, and review surface for reusable UI.

Validation output is recorded as `loopworks.validation_report.v1`. The report
stores ordered per-gate outcomes (`pass`, `fail`, `skipped`), commands, exit
codes, durations, and raw-output references with SHA-256 and byte counts. It
does not embed raw stdout, stderr, prompts, tokens, or credentials. Output
writers receive redacted stdout/stderr, and report byte counts and hashes
describe that redacted persisted output. Queued artifacts use
`validation_report_contract` metadata; completed artifacts use
`validation_report_result` metadata with the parseable report payload. The
report runner produces outcomes only; run/step transitions, downstream
blocking, and lifecycle telemetry stay in the transition layer.

## Consequences

This raises the cost of small UI and workflow changes, but it prevents the product from accumulating untested automation paths. The right level of coverage should match risk: narrow changes get focused tests, while shared workflow, GitHub integration, auth, approvals, Vercel integration, and agent orchestration require broader coverage.

LLM review can summarize or critique deterministic evidence, but it does not replace it.

## Validation

1. `bun run validate` remains the aggregate local quality gate.
2. Markdown changes pass Markdownlint before commit or PR.
3. PRs and agent runs report deterministic validation evidence before judgment.
4. UI changes include Playwright coverage for affected flows and Storybook stories for reusable components.
5. Tests cover auth allowlist, manifest validation, webhook signature/dedupe, Vercel mapping, loop toggles, approval transitions, logger redaction, and persona-derived acceptance scenarios.
6. Validation report tests assert pass/fail/skipped classification, stable V1
   artifact metadata, raw-output references, and the runner's no-transition
   boundary.

## Follow-Ups

1. Add persona-derived Playwright specs for the MVP workflows.
2. Add axe coverage to core dashboard, catalog, Vercel, loops, run detail, and approval views.
3. Add CI artifacts for Playwright screenshots and traces.
4. Define when Lighthouse runs locally, in CI, or as a Vercel-linked check.
