# Contributing

Loopworks is an agentic software factory platform. Contributions should keep
the repository easy to validate, review, and operate.

## Before You Start

Open a GitHub issue before starting large or ambiguous changes, including:

1. Product direction changes.
2. New architecture decisions or ADR updates.
3. New integrations, agent workflows, or loop behavior.
4. Auth, SSO, authorization, token handling, or security-sensitive changes.
5. Broad UI, design-system, data model, or validation strategy changes.

Small, scoped changes can start as a pull request without a prior issue.
Examples include:

1. Improving test coverage.
2. Simple bug fixes.
3. Accessibility fixes.
4. Documentation corrections.
5. Small refactors that do not change behavior.

When in doubt, open an issue first and describe the intended change.

## Commit Style

Use conventional commits:

```text
feat: add loop registry toggle
fix: reject unsigned webhook payloads
docs: clarify Vercel setup
test: cover approval rejection state
chore: update validation tooling
```

Keep commits focused. Split unrelated changes into separate commits or PRs.

## Pull Request Expectations

Every PR should include:

1. The reason for the code change.
2. The user, product, security, or operational problem being solved.
3. A summary of changed behavior.
4. Validation evidence.
5. Linked issues or ADRs when relevant.
6. Screenshots or recordings for meaningful UI changes.
7. Follow-up risks or known gaps.

Avoid code changes that only describe what changed. Explain why the change is
needed and why the chosen approach is appropriate for Loopworks.

## Validation

Before opening or updating a PR, run:

```bash
bun run precommit
```

This runs the same validation path as CI:

1. Biome format check.
2. Biome lint.
3. Agent docs sync check.
4. Markdownlint.
5. TypeScript typecheck.
6. Vitest.
7. Storybook build.
8. Playwright.

For app/runtime changes, also run:

```bash
bun run build
```

If validation cannot be run locally, explain why in the PR and include the
highest-quality evidence available.

## Documentation And Tests

Update docs when behavior, architecture, governance, observability, validation,
or workflow expectations change.

Add or update tests near the changed behavior:

1. Unit or integration tests for shared logic, auth, GitHub/Vercel integration,
   approvals, loop manifests, observability, and agent contracts.
2. Playwright coverage for user-visible workflow changes.
3. Storybook stories for reusable UI components and important states.
4. Markdownlint-compliant docs for contributor-facing changes.

UI work should include accessibility coverage when relevant.

## Agentic Development

Agent-assisted contributions should follow `AGENTS.md`:

1. Plan the work.
2. Define tests and validation.
3. Implement the smallest coherent change.
4. Run deterministic validation.
5. Update docs/backlog artifacts.
6. Perform adversarial review for broad or foundational work.
7. Commit with a conventional commit message.
