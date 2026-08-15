# Loopworks Agent Guide

Loopworks agent work must be issue-backed, scoped, deterministic, observable,
secure, and reviewable.

## Always

1. Preserve user work; never revert unrelated changes without explicit request.
2. Use GitHub Issues for durable product work, decisions, plans, and execution
   state.
3. Follow TDD: write/update tests, show red, then make the smallest green
   change.
4. Read relevant ADRs before changing architecture, integrations,
   observability, testing, fixtures, or workflow governance.
5. Update docs, ADRs, personas, or backlog artifacts when those expectations
   change.
6. Choose the pull request shape before implementation. Default to one PR and
   preserve the request's publication authority; use
   [the stacked-PR guide](docs/development.md#pull-request-shape) and the
   `gh-stack` skill only when dependent PRs are authorized.
7. Delegate with subagents only when tool policy allows it. Write scopes must
   be concrete and disjoint; independent reviewers may share the same
   read-only scope.

## Adversarial review

Every issue implementation gets an adversarial review after its first green
state and before final handoff or publication. This applies whether the work
stops without a PR, ships as one PR, or ships as a stack.

Use two independent read-only subagents in fresh contexts with the same brief.
Give them only the issue, acceptance criteria, test plan, and diff—never the
implementing session's reasoning. For a stack, review each proposed PR diff in
dependency context and the assembled top-of-stack diff before submitting any
layer.

Use this brief verbatim:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Dedupe both findings lists. Fix or defer every finding with a stated reason,
then return the revised diff to both reviewers. Repeat until both have reviewed
the final diff and no finding remains undisposed, then rerun the checks required
by the Validation section. If tool policy cannot provide two independent
reviewers, stop before final handoff or publication and report the blocker.

## Commit provenance

Publication is contributor-safe and GitHub-authoritative:

- Preserve the actual contributor identity represented by the authorized GitHub account. Never substitute a maintainer identity for a contributor.
- Never invent, write, or reuse reserved fixture identities or reserved fixture domains such as `example.com`, `.test`, `.invalid`, or `.localhost`.
- Before any authorized commit, run `bun run commit:preflight`; stop if the effective author/committer identity is malformed, reserved, or unsigned by default.
- Authorized local commits use `git commit -S` and are checked locally with `git verify-commit` or `git log --show-signature` before publication.
- Retain the complete `bun run commit:preflight` output and local signature verification as handoff evidence.
- Push is required before GitHub metadata exists; after pushing, obtain credentials without printing the token (`export GH_TOKEN="$(gh auth token)"` and `export GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"`), then run `bun run commit:provenance --github <PR>`. Record the GitHub-resolved author and signature result; no user handoff occurs before this GitHub verification passes. Stop on any identity or signature mismatch.

## Routing

Before changing a scoped area, read its nearest guide:

- `src/AGENTS.md`: app, auth, DB, integrations, routes.
- `src/components/AGENTS.md`: reusable UI.
- `src/lib/observability/AGENTS.md`: logging, metrics, traces.
- `tests/AGENTS.md`: Vitest, Playwright, fixtures.
- `docs/AGENTS.md`: product, architecture, personas, security docs.
- `docs/adr/AGENTS.md`: ADRs.
- `agent/AGENTS.md`: Eve and agent orchestration.
- `scripts/AGENTS.md`: repository scripts and bootstrap tooling.
- `.github/AGENTS.md`: workflows and issue templates.

## Validation

Use focused checks while working. `bun run check` is the Biome format, lint,
and assists gate; `format:check` and `lint` alone miss assists. For broad changes
run `bun run validate`; app/runtime changes also require `bun run build`.
Before committing, run `bun run precommit` or let `pre-k` run it.

## Agent Docs

`AGENTS.md` is canonical. `CLAUDE.md` files are generated import shims. Do not
hand-edit them; after changing any `AGENTS.md`, run `bun run agent-docs:sync`.

<!-- markdownlint-disable MD025 -->
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
<!-- markdownlint-enable MD025 -->
