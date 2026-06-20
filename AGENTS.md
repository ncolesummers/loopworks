# Loopworks Agent Guide

## Purpose

This repo is itself an agentic software factory. Agent work in Loopworks should model the workflows the product is building: issue-backed planning, scoped execution, deterministic validation, documentation, adversarial review, and adjustment before commit or PR.

## Operating Principles

1. GitHub Issues are the durable source of truth for product work, decisions, plans, and execution state.
2. Prefer small, reviewable changes tied to a concrete issue, milestone, and acceptance criteria.
3. Use deterministic checks before LLM judgment.
4. Treat observability, auditability, and security as product requirements, not cleanup work.
5. Preserve user work. Never revert unrelated changes without explicit instruction.
6. Keep the app usable and inspectable after each meaningful slice.

## Expected Agent Workflow

1. Planning
   - Read the relevant issue, docs, existing code, and tests.
   - Write or update an executable plan when the work is more than a small local fix.
   - Identify affected areas: product/docs, UI, backend/integration, observability, security, tests.

2. Test Design
   - Define the validation evidence before implementation.
   - Add or update focused unit/integration tests for shared logic, GitHub/Vercel integration, auth, approvals, loop manifests, and observability.
   - Add Playwright coverage for user-visible workflow changes.
   - Add Storybook stories for reusable UI components and important states.

3. Implementation
   - Keep edits scoped to the issue.
   - Follow existing Next.js App Router, ShadCN/UI, Tailwind, Drizzle, Auth.js, Pino, and testing patterns.
   - Prefer typed contracts and schemas over ad hoc object shapes.
   - Log integration and workflow boundaries with structured Pino logs.

4. Validation
   - Run deterministic checks before considering the task complete:
     - `bun run format:check`
     - `bun run lint`
     - `bun run typecheck`
     - `bun run test`
     - `bun run storybook:build`
     - `bun run test:e2e`
   - For broad changes, run `bun run validate`.
   - For app/runtime changes, also run `bun run build`.

5. Docs And Backlog
   - Update docs when behavior, architecture, governance, observability, or workflow expectations change.
   - Update the GitHub backlog/bootstrap script when new foundational work needs durable tracking.
   - Durable decisions should become ADR proposals or explicit issue comments.

6. Adversarial Review
   - Before committing broad or foundational work, spawn or request an adversarial review subagent.
   - Ask it to look for blockers, security regressions, overclaims, missing tests, public repo secret risks, and mismatches with the issue acceptance criteria.
   - Address P0/P1 findings before commit, or document why they are explicitly deferred.

7. Commit And PR
   - Create atomic, conventional commits after validation and review.
   - PR descriptions should include scope, validation evidence, screenshots when UI changed, docs updates, and known follow-ups.

## Subagent Use

Use subagents liberally when the work benefits from parallel or adversarial attention.

Recommended splits:

1. Product/docs/backlog agent: PRD, architecture, issue bodies, labels, milestones, project setup.
2. Frontend agent: ShadCN shell, Storybook stories, Playwright-visible UI slices, responsive/a11y checks.
3. Backend/integration agent: Drizzle schema, GitHub/Vercel clients, webhook/event-store contracts, Auth.js boundaries.
4. QA/security agent: validation scripts, adversarial review, threat model, auth/session/webhook/token checks.
5. Observability agent: Pino logging, correlation fields, metrics/tracing contracts, alerting follow-ups.

When delegating:

1. Give each subagent a clear scope and file ownership.
2. Tell coding subagents they are not alone in the codebase and must not revert others' work.
3. Prefer disjoint write sets to avoid conflicts.
4. Main agent owns final integration, validation, and commit quality.

## UI Work Rules

1. Use ShadCN/UI as the component foundation until the design-system planning issue says otherwise.
2. Reusable components need Storybook stories.
3. User-visible flows need Playwright coverage.
4. UI changes need accessibility checks where relevant.
5. Keep dashboard surfaces dense, stable, and operational. Avoid marketing-style pages inside the app.

## Observability Rules

1. Use the shared Pino logger in `src/lib/observability/logger.ts`.
2. Include correlation fields where available: route, GitHub delivery id, repo, issue, loop, run, step, approval, Vercel project, deployment, trace id.
3. Do not log tokens, private keys, auth headers, raw webhook payload bodies, OAuth token fields, or unreviewed prompt bodies.
4. Logs are not the event store. Persist durable workflow state in Drizzle-backed control-plane tables.
5. Fixture fallbacks must be explicit in logs and API responses.

## Security Rules

1. Protect app and internal API routes by default.
2. GitHub webhook routes must verify signatures before processing payloads.
3. Local auth bypass must not work in production.
4. External write paths require explicit approvals and audit attribution.
5. The MVP cannot be called complete until the security review issue is closed or follow-ups are created.

## Current Foundation

The initial scaffold uses:

1. Next.js App Router, TypeScript, Bun.
2. ShadCN/UI and Tailwind.
3. Auth.js GitHub provider with username/org allowlist and non-production fixture bypass.
4. Postgres and Drizzle schema foundations.
5. Pino structured logging.
6. GitHub webhook skeleton and local/dev fixture path.
7. Vercel deployment visibility client with explicit fixture fallback.
8. Eve planning-agent skeleton.
9. Biome, Vitest, Playwright, Storybook, and CI validation.

