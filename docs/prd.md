# Loopworks PRD

## Summary

Loopworks is an agentic software factory portal for planning, executing, validating, and improving software delivery loops. It is similar in spirit to Backstage because it gives teams a catalog and operational portal, but its center of gravity is agentic development work: issues, plans, loops, runs, approvals, validation evidence, artifacts, pull requests, and deployment visibility.

GitHub is the source of truth for roadmap and work state. GitHub Issues hold product intent, milestones, plans, durable decisions, and execution status. Loopworks reads and organizes that state, writes durable summaries back to GitHub, and stores low-level operational events in its own control plane so the portal can audit, resume, retry, and explain agent runs without turning GitHub into an event database.

## Product Goals

1. Make GitHub Issues the canonical planning and execution surface for agentic development work.
2. Provide a clear portal for repositories, loops, agents, runs, artifacts, validation gates, approvals, PRs, and deployments.
3. Make `agent-ready` issues executable while keeping human approval and deterministic validation visible.
4. Give maintainers a durable run history with status, artifacts, retries, locks, costs, traces, and metrics.
5. Make Vercel deployment and preview status easy to inspect from the same surface as the work item.
6. Support configurable loops per repo so teams can enable, disable, and govern automation deliberately.
7. Create an evaluation and governance path before expanding agent autonomy.
8. Treat observability as a product capability with structured logs, metrics, traces, and durable artifacts.

## Non-Goals

1. Replacing GitHub Issues, PRs, Checks, or Projects as durable collaboration surfaces.
2. Building a general purpose project management suite unrelated to software delivery loops.
3. Auto-merging code without explicit policy, validation, and review gates.
4. Building broad enterprise administration before the MVP loop is working.
5. Capturing every low-level event in GitHub comments.

## Primary Users

1. Product operator: shapes roadmap, writes issues, reviews plans, and decides when work is ready.
2. Maintainer: configures repos, loop manifests, validation gates, approvals, and integration credentials.
3. Builder agent: reads issues, writes executable plans, performs scoped implementation work, and produces artifacts.
4. Reviewer: inspects run history, validation evidence, PRs, deployments, and approval gates.
5. Security reviewer: checks auth, secrets, webhook verification, approvals, token scopes, and audit evidence before MVP completion.

The current persona details and derived acceptance-test matrix live in `personas-and-test-scenarios.md`. MVP issues should reference those scenarios when they touch user-visible workflows or risky integration behavior.

## Source Of Truth Model

GitHub owns:

1. Issues, labels, milestones, comments, and Projects backlog state.
2. PRs, commits, branches, reviews, checks, and merge state.
3. Durable planning summaries and ADR proposals when conversations create long-lived decisions.
4. Human-readable run summaries and links to Loopworks run records.

Loopworks owns:

1. Internal run, step, artifact, retry, trace, lock, cost, status, and metric records.
2. Idempotency records for GitHub webhooks and other external events.
3. Loop configuration snapshots and manifest validation state.
4. Approval gate records, approver identity, and audit trails.
5. Derived catalog metadata and deployment summaries used by the portal.

The portal should avoid duplicating GitHub as a parallel planning system. It can cache and derive state, but the durable collaboration object remains the GitHub Issue or PR.

## MVP Scope

The first usable Loopworks slice includes:

1. GitHub SSO with Auth.js GitHub provider, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, and a username/org allowlist.
2. Authenticated dashboard shell with repo catalog, loop registry, run timeline, approval gates, GitHub settings, and Vercel deployment visibility.
3. Repo catalog with owners, framework metadata, CI commands, docs links, observability links, design system links, Vercel project links, and enabled loops.
4. Loop registry with enabled/disabled toggles and a draft loop manifest schema.
5. GitHub issue trigger for `agent-ready`; `spike` plus `agent-ready` routes to a deep research workflow.
6. One durable development loop skeleton with stages for planning, test-writing, development, validation, code review, commit, PR, and completion.
7. Run timeline with step status, artifacts, deterministic validation output, approval state, and links back to GitHub/Vercel.
8. Initial planning agent skeleton using Eve.
9. Vercel integration for production and preview deployments, deployment status, preview URL, branch, commit metadata, deployment age, event/log summaries, and Vercel links.
10. Deterministic validation hooks before LLM judgment: typecheck, tests, Biome, Playwright, a11y, Lighthouse where relevant, and security checks where relevant.
11. PR creation path or dev-mode PR intent artifact after validations and approvals pass.
12. MVP security review issue before declaring the MVP complete.
13. Pino structured logging for API and integration boundaries with redaction and correlation fields.

## User Experience Requirements

1. The first screen after sign-in should show operational state, not a marketing page.
2. The dashboard should make blocked, running, ready-for-approval, failed, and done states obvious.
3. Repo catalog cards and tables should be dense enough for repeated operator use.
4. Loop toggles must show enabled state, validation gates, trigger labels, approval requirements, and last run status.
5. Run timelines must show deterministic checks before any agent judgment.
6. Approval gates must show who approved, what changed, what validation evidence exists, and what operation will happen next.
7. Vercel previews should be inspectable without leaving the work context.
8. UI components should have Storybook coverage before becoming broad reusable primitives.

## Design System Direction

Loopworks will use ShadCN/UI as the starting component foundation, but the product needs its own design system direction before broad UI expansion. M1 includes a dedicated design-system planning issue and a separate design chat/prompt to determine brand, tokens, layout density, component conventions, Storybook taxonomy, and review expectations.

The temporary theme should be minimal and pragmatic. It should not become the final brand by accident. Core design principles for the first pass:

1. Functional over decorative.
2. Dense but readable operational surfaces.
3. Stable layout dimensions for tables, timelines, status badges, cards, and controls.
4. Clear state vocabulary across loading, empty, blocked, failed, pending, approved, and done.
5. Icons for familiar actions and text labels for business-critical commands.

## Architecture Requirements

1. Build an internal control plane/event store for runs, steps, artifacts, retries, traces, locks, costs, status, and metrics.
2. Write summaries and durable links back to GitHub, not every low-level event.
3. Define a loop manifest schema early. It must cover triggers, enabled state, repo scope, labels, schedules, model policy, budgets, approvals, artifact contracts, validation gates, retries, concurrency, and cancellation.
4. Add governance for loop changes: proposed diffs, schema validation, evals, and PR review.
5. Add idempotency and locking for GitHub webhook events.
6. Run deterministic validation before LLM judgment.
7. Add agent evals for prompt, model, tool, and workflow changes.
8. Build a Backstage-style repo/service catalog with owners, metadata, framework, CI commands, docs links, observability links, design system links, and enabled loops.
9. Add golden-path templates for supported stacks: Next.js, FastAPI, full-stack Next.js plus FastAPI, docs site, internal tool, and agent-enabled repo.
10. Capture durable architecture decisions in ADRs and keep issue acceptance criteria aligned with accepted decisions.

## Integration Requirements

### GitHub

1. Auth.js GitHub SSO for users.
2. GitHub App and webhook flow for issue events, labels, milestones, PRs, checks, and comments.
3. Local/dev fixture path for signed webhook payloads.
4. Idempotency by delivery id and normalized event key.
5. Labels: `agent-ready`, `spike`, `needs-approval`, area labels, priority labels, and loop labels.
6. Milestones aligned to the Loopworks roadmap.
7. GitHub Project/backlog created from the bootstrap script.

### Vercel

1. Configure `VERCEL_ACCESS_TOKEN` and optional team slug/id.
2. Link catalog repos to Vercel projects.
3. Show latest production and preview deployments.
4. Show status, deployment URL, branch, commit SHA/message, age, event/log summary, and Vercel links.
5. Keep MVP scope to observability and visibility, not full Vercel project administration.

### Agents

1. Use Eve for the initial planning agent skeleton.
2. Keep agent tools narrow and auditable.
3. Make generated plans executable and updateable.
4. Attach validation evidence and artifacts to run steps.
5. Require approvals before high-impact operations.

## Quality And Development Practice

Repo quality gates are first-class from day one:

1. Biome for formatting, linting, and TypeScript/JavaScript static analysis.
2. Markdownlint for Markdown documentation static analysis.
3. TypeScript typechecking.
4. Vitest for focused unit and integration coverage.
5. Playwright for browser and workflow coverage.
6. Axe checks for UI accessibility where relevant.
7. Storybook for reusable component development, review, and documentation.
8. Storybook build as part of validation.
9. Aggregate validation script for local and CI use.
10. Pino structured logging with tests for redaction and integration fallback paths.

UI work is not complete until relevant Playwright coverage and Storybook stories are added or intentionally deferred in the issue.

Workflow work should reference persona-derived test cases where applicable. The matrix in `personas-and-test-scenarios.md` is the starting set for MVP acceptance coverage.

## MVP Milestones

### M0 Project Foundation

Create the PRD, ADR baseline, repo scaffold, Next.js/Bun setup, TypeScript, Tailwind, ShadCN primitives, Biome, Playwright, Storybook, Vitest, Pino structured logging, CI, issue templates, and GitHub backlog bootstrap.

Exit criteria:

1. Repo builds locally.
2. Validation scripts pass.
3. GitHub repo, labels, milestones, issues, and backlog project exist.
4. PRD and architecture docs are checked in.
5. Foundational ADRs and persona-derived test scenarios are checked in.
6. Persona test IDs P01, P03, R02, and S04 are referenced by the milestone and seeded issues.

### M1 Design System Direction + App Shell

Resolve the dedicated design-system planning issue, define initial tokens and Storybook taxonomy, and harden the app shell/navigation patterns.

Exit criteria:

1. Design principles and temporary-vs-final token stance are documented.
2. Shared ShadCN-based primitives have stories.
3. Shell, navigation, empty/loading/error states, and responsive behavior are covered.
4. Persona test IDs P01, P04, M01, A02, and R02 are referenced by the milestone and seeded issues.

### M2 GitHub + Vercel Source Systems

Implement GitHub SSO, repo catalog, GitHub App/webhooks/dev fixtures, and Vercel project/deployment visibility.

Exit criteria:

1. GitHub sign-in and allowlist enforcement work.
2. Signed GitHub issue fixtures can create normalized events.
3. Repos can link to Vercel projects.
4. Deployments/previews are visible in catalog and detail views.
5. Persona test IDs P02, M01, M03, R01, S01, S02, and S03 are referenced by the milestone and seeded issues.

### M3 Durable Loop MVP

Implement loop registry, `agent-ready` trigger, development-loop skeleton, run timeline, artifacts, approval gates, and planning agent.

Exit criteria:

1. Enabled loops can be toggled per repo.
2. `agent-ready` issues can start or simulate the development loop.
3. Runs record stages, artifacts, validation evidence, approvals, and retryable failures.
4. The planning agent can create and update an executable plan artifact.
5. Persona test IDs M02, A01, A02, A03, and R01 are referenced by the milestone and seeded issues.

### M4 Validation + PR Path + MVP Security Review

Add deterministic validation hooks, PR creation path, and the final MVP security review.

Exit criteria:

1. Validation gates run before LLM judgment and before PR creation.
2. PR creation path records branch, commit, PR, checks, and review state.
3. MVP security review issue is completed or follow-ups are created.
4. Persona test IDs A03, R01, R02, S01, S02, S03, and S04 are referenced by the milestone and seeded issues.

### M5 Agent Governance + Evals

Add governance for loop changes, proposed diffs, schema validation, evals, and model/prompt/tool/workflow change checks.

Exit criteria:

1. Loop changes require reviewable diffs.
2. Agent prompt/model/tool changes have eval scenarios.
3. Governance policy is visible in the portal and in PR checks.
4. Persona test IDs P03, A02, A03, R02, and S04 are referenced by the milestone and seeded issues.

## Success Metrics

1. An `agent-ready` issue can be tracked from intake to loop completion without manual state duplication.
2. The operator can see current repo, loop, run, approval, and deployment state in one place.
3. Deterministic validation results are visible before any agent judgment.
4. Vercel preview links and deployment summaries are available for active work.
5. Human approvals are auditable by user, action, time, and evidence.
6. The system can replay or explain why a webhook did or did not trigger a loop.
7. Agent behavior changes can be evaluated before becoming default.
8. Operators can correlate logs, artifacts, run ids, GitHub delivery ids, and Vercel deployment ids.

## Open Questions

1. Final design system direction, brand language, and token palette.
2. Exact GitHub App permissions for MVP versus later autonomy.
3. Initial Vercel log/event depth and rate-limit handling.
4. Which repo templates get built first after the MVP loop.
5. Whether the first durable run store should be append-only event tables only or event tables plus current-state projections.
6. Which metrics backend and trace collector should receive Loopworks runtime telemetry after the Pino foundation.
