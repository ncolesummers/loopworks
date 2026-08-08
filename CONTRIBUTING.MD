# Contributing

Loopworks contributions should be scoped, test-driven, and easy to review.
Read the root `AGENTS.md` and the nearest directory guide before changing a
scoped area.

## Before You Start

Open a GitHub issue before broad or ambiguous work, especially changes to
product direction, architecture, integrations, agents, auth, security, the data
model, UI foundations, or validation policy. Small documentation corrections,
test coverage, accessibility fixes, and behavior-preserving refactors may start
as a pull request.

When a decision changes a durable architectural direction, propose or update an
ADR under `docs/adr/` and link it from the issue.

## Development Workflow

1. Define acceptance criteria and the validation plan.
2. Add tests and capture the expected failing evidence.
3. Make the smallest coherent change that passes them.
4. Update affected documentation and run deterministic validation.
5. Review broad changes adversarially before publication.

Use focused conventional commits, for example:

```text
fix: reject unsigned webhook payloads
```

## Validation

Before opening or updating a pull request, run:

```bash
bun run precommit
```

App and runtime changes also require `bun run build`. If a gate cannot run
locally, explain why and include the best available evidence in the pull
request. Do not replace `bun run check` with its narrower formatting or lint
subcommands.

Use the [pull request template](.github/pull_request_template.md) for the
required issue, red evidence, green validation, documentation, and review
record.
