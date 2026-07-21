# Loopworks Architecture

## System Shape

Loopworks is a Next.js App Router application backed by Postgres and Drizzle. It presents an authenticated operator portal over GitHub, Vercel, and Loopworks' internal control plane. GitHub remains the collaboration source of truth. Loopworks stores durable operational state that GitHub is not designed to hold: runs, steps, artifacts, traces, retries, locks, costs, approvals, and metrics.

The MVP should favor working slices over broad platform abstractions. The core architecture still needs strong boundaries early because agent workflows become hard to reason about if source-system state, internal execution state, and UI state are mixed together.

## Runtime Stack

1. App: Next.js App Router, React, TypeScript, Bun.
2. UI: Tailwind CSS, ShadCN/UI primitives, Storybook.
3. Auth: Auth.js GitHub provider with username/org allowlist.
4. Data: Postgres with Drizzle ORM.
5. Agent framework: Planning-agent skeleton on Eve runtime.
6. Vercel infrastructure: Vercel deployment visibility first, with Vercel Workflows, Sandbox, Connect, and AI Gateway as likely expansion points.
7. GitHub: GitHub App/webhooks, REST/GraphQL APIs, Issues, Labels, Milestones, Projects, PRs, Checks/Statuses.
8. Quality: Biome, TypeScript, Vitest, Playwright, Axe, Storybook build.
9. Observability: Pino structured logs now, with metrics and traces designed into the control plane.

The accepted stack and workflow decisions are recorded in `adr/README.md`. Architecture changes should update or supersede the relevant ADR instead of only changing implementation code.

## Boundary Model

### Source Systems

GitHub and Vercel are external sources of truth for their own domains.

GitHub owns:

1. Issues, labels, milestones, comments, Projects, PRs, reviews, checks, branches, and commits.
2. Human-readable planning updates and durable links to Loopworks runs.
3. ADR proposals when durable decisions are produced.

Vercel owns:

1. Projects, deployments, preview URLs, production URLs, deployment events, logs, branch metadata, commit metadata, and status.

### Loopworks Control Plane

Loopworks owns:

1. Normalized integration events and idempotency records.
2. Run records and step timelines.
3. Artifact records and external artifact links.
4. Approval records and attribution.
5. Loop manifest snapshots and validation state.
6. Retry, cancellation, concurrency, lock, cost, trace, and metric records.
7. Derived catalog projections for fast UI rendering.
8. Structured log correlation fields for request, webhook, run, step, repo, issue, approval, and deployment identifiers.

### Presentation State

Presentation state should stay local to the app or user session unless it affects durable workflow behavior. Filters, selected views, and UI preferences should not become workflow state.

## Data Model

The initial schema should support these tables:

1. Auth tables: users, accounts, sessions, verification tokens.
2. Repositories: GitHub owner/name, default branch, owner team, framework, CI commands, docs, observability, design system links, Vercel project link.
3. Vercel projects and deployments: project id/name, deployment id/url/status/environment/branch/commit/age/summary.
4. Loop definitions: key, name, description, enabled state, trigger labels, repo scope, manifest version.
5. Runs: loop id, repo id, GitHub issue id/number, status, started/completed timestamps, current stage, cost summary.
6. Steps: run id, stage, status, started/completed timestamps, deterministic check output, agent summary.
7. Artifacts: run id, step id, type, title, URI, metadata, checksum where relevant.
8. Approvals: run id, gate key, status, approver identity, rationale, evidence URI, timestamps.
9. GitHub events: delivery id, event name, action, installation id, payload summary, processed status, error summary.
10. Idempotency locks: key, scope, acquired/expired timestamps, owner, status.
11. Observability events or projections: correlation ids, metric counters, trace links, log summary links, and alert state.

## Observability

Loopworks uses Pino for structured JSON logging. Every integration boundary should use a request-scoped child logger and emit structured events for accepted, rejected, duplicate, fallback, and failure paths. Logs must carry correlation fields instead of burying identifiers in message strings.

Required correlation fields include, where available:

1. GitHub delivery id, event, action, repository full name, issue number, and PR number.
2. Loop key, run id, step id, artifact id, approval id, and actor id.
3. Vercel project id, deployment id, environment, branch, and commit sha.
4. Validation command, validation gate, status, duration, and artifact URI.
5. Agent name, model policy, tool name, budget id, and trace id.

Logs are not the event store. The control plane must still persist durable run, step, artifact, approval, idempotency, retry, cost, trace, and metric state. Logs explain runtime behavior and support debugging; durable tables support product state, auditability, and replay.

## Event And Idempotency Flow

1. Receive GitHub webhook.
2. Verify signature using the configured webhook secret.
3. Extract delivery id, event name, action, installation id, repository, issue/PR identifiers, labels, and sender.
4. Create or check idempotency record by delivery id and normalized event key.
5. Acquire a short-lived lock for repo plus issue plus trigger type.
6. Normalize the event into Loopworks event tables.
7. Evaluate loop triggers from the active manifest snapshot.
8. Create a run or append a skipped/no-op decision with a durable reason.
9. Write a summary or durable link back to GitHub only when useful to humans.

Webhook processing must be repeat-safe. Re-delivery should not create duplicate runs, duplicate comments, or conflicting approval gates.

## Loop Manifest

The loop manifest should be versioned and validated. It must include:

1. Loop key, name, description, and enabled state.
2. Repo scope and branch constraints.
3. Trigger labels, issue states, schedules, and manual triggers.
4. Model policy, tool policy, and budget limits.
5. Approval gates and bypass policy.
6. Artifact contracts for plans, validation reports, screenshots, typed review
   results, patches, PR intents, and summaries.
7. Validation gates and required commands.
8. Retry limits and backoff policy.
9. Concurrency groups and cancellation behavior.
10. GitHub writeback rules.

Loop changes should be proposed as diffs, validated against schema, covered by evals when behavior changes, and reviewed in PRs.

## Deterministic Validation

The validation order is:

1. Static checks: formatting, linting, typecheck.
2. Unit and integration tests.
3. Browser workflow tests for UI or workflow changes.
4. Accessibility checks for UI changes.
5. Lighthouse where relevant.
6. Security checks where relevant.
7. LLM review or judgment only after deterministic evidence is available.

Agent-generated claims should reference the deterministic evidence rather than replacing it.
UI-affecting runs must additionally persist a digest-bound screenshot manifest
covering every browser journey at mobile `390x844`, laptop `1280x832`, and
desktop `1440x960`. Validation owns capture and fails closed before LLM review
when a browser journey or required capture is absent.

## GitHub Integration

MVP capabilities:

1. GitHub SSO through Auth.js.
2. Username/org allowlist for app access.
3. GitHub App webhook skeleton with signature verification.
4. Dev fixture path for signed issue events.
5. Label and milestone bootstrap script.
6. Issue trigger for `agent-ready`.
7. `spike` plus `agent-ready` classification for research workflows.
8. Guarded draft-PR creation plus an offline PR-intent artifact path.

Later capabilities:

1. Checks/statuses for validation summaries.
2. Durable issue comments with run links.
3. GitHub Project field synchronization.
4. ADR proposal generation from durable decisions.
5. Broader branch policies, merge automation, and non-PR GitHub writes.

## Vercel Integration

MVP capabilities:

1. Store Vercel project links on catalog repos.
2. Fetch latest production and preview deployments.
3. Show deployment status, branch, commit metadata, age, deployment URL, and Vercel link.
4. Summarize events/logs enough for a human to know whether the app is healthy.

Non-MVP:

1. Full Vercel project administration.
2. Automatic environment variable mutation.
3. Deployment rollback automation.

## Agent Architecture

The root Eve runtime is a neutral stage orchestrator. It reads durable run
state, verifies approvals and artifact prerequisites, delegates to one declared
stage subagent, validates the typed result, and invokes deterministic
control-plane transitions. Stage subagents are siblings with independent model,
tool, and isolated sandbox contracts; they do not own GitHub writes or workflow
state transitions.

The planner subagent should:

1. Read a GitHub issue and repo metadata.
2. Create or update an executable plan artifact.
3. Identify validation gates and approval points.
4. Produce a clear next-action summary.
5. Avoid mutating code or GitHub state outside explicit tool contracts.

Stage specialists use typed handoffs and independent capability boundaries:

1. Research loop skeleton, research planner, researcher, and research author agents — the `spike` plus `agent-ready` research loop, run in parallel to the development loop.
2. Test-writer subagent — test-writing stage, red test evidence plus a reusable automated test plan, explicit seed data, and a bounded test-only patch.
3. Implementation subagent — development stage, digest-bound production patch
   plus signed focused and aggregate green evidence. It reuses the exact
   test-writing patch and fixtures, while the root owns persistence and the
   transition to validation.
4. Validation review subagent — code review stage, Terra/xhigh typed findings
   over persisted validation-owned screenshot evidence and deterministic
   results. It recommends `commit`, `development`, or `test-writing`; only the
   root applies the route. Backward routes reuse and increment affected step
   rows, clear execution claims, reset invalidated artifacts, retain the
   approved plan, and preserve digest/route history for replay.
5. PR preparation subagent — PR stage, Terra/xhigh bounded narrative plus exact
   issue, run, validation, review, deployment, artifact, and validation-owned
   screenshot references. The root persists the typed result; the guarded
   writer alone owns GitHub mutation.
6. Release notes subagent — done stage, completion summary.

The commit stage intentionally stays mechanical, owned by the PR creation path rather than a dedicated subagent. Typed artifacts bridge isolated subagent sandboxes, and each subagent needs eval coverage before promotion to default use.

## Security Architecture

Security-sensitive MVP areas:

1. Auth.js session handling and callback validation.
2. GitHub allowlist enforcement.
3. GitHub webhook signature verification.
4. Secret handling for GitHub App credentials and Vercel token.
5. Token scopes and least privilege.
6. Idempotency and lock bypasses.
7. Approval gate bypasses.
8. Public repo secret hygiene.
9. SSR and API route authorization.
10. Audit attribution for approvals and high-impact actions.

The M4 security review issue must check these areas before MVP completion.

## CI And Local Validation

CI should run:

1. Bun install.
2. Biome formatting and linting.
3. TypeScript typecheck.
4. Vitest tests.
5. Storybook build.
6. Playwright browser tests.

Local validation should mirror CI through `bun run validate`.

Persona-derived acceptance scenarios in `personas-and-test-scenarios.md` should guide which browser workflows, state variations, and integration edges receive coverage first.
