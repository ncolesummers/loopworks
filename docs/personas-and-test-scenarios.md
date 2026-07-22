# Personas And Test Scenarios

Loopworks should be tested against the people who will use it, not only against isolated components. These personas are intentionally practical: each one maps to workflows, risks, and acceptance tests that should influence Playwright, Storybook, unit, and integration coverage.

## Personas

### Product Operator

Owns roadmap clarity and decides when an issue is ready for an agentic loop.

Needs:

1. A clear view of issues, milestones, loop readiness, and blocked work.
2. Confidence that `agent-ready` means the issue has enough context.
3. Durable plans and decisions linked back to GitHub.

Risks:

1. Accidentally triggering automation before scope is clear.
2. Losing decisions in chat history instead of GitHub issues or ADRs.
3. Seeing run state in Loopworks that disagrees with GitHub.

### Maintainer

Owns repository configuration, loop manifests, validation gates, integration credentials, and catalog metadata.

Needs:

1. Repo catalog metadata with owner, framework, CI commands, docs, observability links, design-system links, Vercel project mapping, and search/filter controls.
2. Loop toggles that clearly show enabled state, triggers, approvals, and validation gates.
3. Safe fixture and seed data for local development.

Risks:

1. Enabling a loop on the wrong repo or without required validation.
2. Silent fixture fallback hiding a broken production integration.
3. Missing logs or metrics when a workflow fails.

### Agent Supervisor

Monitors agentic runs, reviews plans, inspects artifacts, and decides whether a loop may advance.

Needs:

1. Run timelines with stages, status, timestamps, validation evidence, artifacts, retries, and blocked reasons.
2. Approval gates with clear consequences and audit attribution.
3. Planning-agent output that is executable, reviewable, and updateable.

Risks:

1. Approving a risky operation without seeing deterministic evidence.
2. Confusing LLM judgment with passing tests.
3. Losing track of retries, cancellations, and partial failures.

### Reviewer

Reviews PRs, validation evidence, Vercel previews, and implementation artifacts.

Needs:

1. PR context connected to the source issue and Loopworks run.
2. Deterministic validation summaries before code review.
3. Vercel production and preview links with commit and branch metadata.

Risks:

1. Reviewing code without knowing whether the built app works.
2. Missing a failed a11y, Playwright, or Storybook check for UI work.
3. Accepting a PR summary that overstates the evidence.

### Security Reviewer

Reviews the MVP before it is called shippable and checks high-risk integration paths.

Needs:

1. Auth/session boundaries, username/org allowlists, GitHub webhook verification, token handling, and approval paths documented.
2. Logs that prove behavior without exposing secrets.
3. Follow-up issues for unresolved findings.

Risks:

1. Auth bypass working in production.
2. Webhook replay or idempotency bugs causing duplicate runs.
3. Tokens, raw payloads, or prompts leaking into logs or public repo files.

## Persona-Derived Test Cases

| ID | Persona | Scenario | Primary Coverage |
| --- | --- | --- | --- |
| P01 | Product Operator | A signed-in operator navigates dashboard, catalog, loop, run, approval, deployment, and settings route slices with a consistent session surface. | Playwright, a11y |
| P02 | Product Operator | An issue with `agent-ready` normalizes into a development loop trigger; `spike` plus `agent-ready` normalizes into a research trigger. | Unit, integration |
| P03 | Product Operator | A durable decision from planning links to an ADR proposal or accepted ADR. | Integration, docs review |
| P04 | Product Operator | An operator switches between light and dark mode from the app shell; the choice persists across reloads and both themes meet contrast. | Playwright, a11y |
| M01 | Maintainer | Catalog rows show owner, framework, CI commands, docs, observability, design-system, enabled loops, Vercel project links, and search/filter controls. | Playwright, Storybook |
| M02 | Maintainer | Turning either development or research routing off prevents trigger execution and records the loop-specific skipped reason without fabricating a run. | Unit, integration, Playwright |
| M03 | Maintainer | Missing Vercel credentials in dev returns explicit fixture fallback metadata; production does not silently return fixtures. | Unit, integration |
| A01 | Agent Supervisor | Run detail shows the exact loop sequence and artifacts: all development stages with separate red/test-plan evidence, or research planning, researching, authoring, and done with four placeholder contracts. | Unit, Storybook, Playwright |
| A02 | Agent Supervisor | Approval gates show requested, approved, rejected, bypassed, and expired states with actor and evidence; test writing requires an exact approved plan review. | Unit, Storybook, Playwright |
| A03 | Agent Supervisor | AC-mapped expected-red evidence appears before implementation, and green deterministic validation appears before LLM review or judgment. | Integration, Playwright |
| R01 | Reviewer | A PR intent or created PR links to the source issue, run, validation artifacts, and Vercel preview. | Integration, Playwright |
| R02 | Reviewer | UI changes include Storybook stories, design-token usage, and browser workflow coverage with axe passing in light and dark before the task is complete. | CI, Storybook build, Playwright, a11y |
| S01 | Security Reviewer | GitHub webhook requests with invalid signatures are rejected before payload processing. | Unit, integration |
| S02 | Security Reviewer | Repeated delivery ids do not create duplicate runs. | Unit, integration |
| S03 | Security Reviewer | Local auth bypass cannot work in production environments. | Unit |
| S04 | Security Reviewer | Logger redaction removes token, secret, authorization, OAuth, and webhook-sensitive fields. | Unit |
| S05 | Security Reviewer | GitHub SSO allowlists reject unauthorized identities and persist the GitHub login used for approval attribution. | Unit, Playwright |

## MVP Milestone Map

| Milestone | Persona Test IDs |
| --- | --- |
| M0 Project Foundation | P01, P03, R02, S04 |
| M1 Design System Direction + App Shell | P01, P04, M01, A02, R02 |
| M2 GitHub + Vercel Source Systems | P02, M01, M03, R01, S01, S02, S03, S05 |
| M3 Durable Loop MVP | M02, A01, A02, A03, R01 |
| M4 Validation + PR Path + MVP Security Review | A03, R01, R02, S01, S02, S03, S04 |
| M5 Agent Governance + Evals | P03, A02, A03, R02, S04 |

## How To Use This Matrix

1. New MVP issues should reference the relevant persona test IDs in acceptance criteria.
2. Playwright specs should cover full-person workflows, not only page loads.
3. Storybook stories should cover state variations that matter to a persona.
4. Unit and integration tests should protect risky decision points: auth, triggers, idempotency, validation order, approvals, Vercel mapping, fixture fallback, and logging.
5. When a persona need changes, update this matrix and the GitHub backlog together.
