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

Reviewers are read-only subagents in fresh contexts working from the same
brief. Give them only the issue, acceptance criteria, test plan, and diff—never
the implementing session's reasoning.

Size the review by blast radius, not diff size. One reviewer suffices for
lockfile-only dependency bumps, documentation edits that change no procedure or
control, line-citation or wording fixes, prompt wording, and test-only
refactors that change no assertion. Wording that changes a rule, threshold, or
gate is not a wording fix, wherever it lives. Two independent reviewers are
mandatory for anything under `src/`, `.github/workflows/`, `scripts/`, the
`.omnigent/` policy bundle, auth or session code, database schema or
migrations, and any change to what a security gate or CI check accepts—pins,
checksums, allowlists, ignore files, or overrides—or whether it runs at all. A
bump that only moves resolved dependency versions stays at one reviewer;
editing what a gate tolerates is two. A change that mixes tiers takes the
higher tier. When unsure, use two.

A stack is a team scheduling primitive: implement it from bottom to top and
publish each independently reviewable lower layer as a draft after its own
gates so human review can overlap work on a later layer, unless the user
explicitly requires atomic publication. Before publishing the first layer,
review that layer. Before publishing each later layer, review its diff in
dependency context and the assembled top-of-stack diff. Each layer's tier is
its own blast radius, so a stack can mix one-reviewer and two-reviewer layers.
Exactly one adversarial review round is allowed per issue implementation or
newly implemented stack layer. A round is one pass by every reviewer the tier
requires over every diff in that scope.

Use this brief verbatim:

> You did not write this and do not want it merged. Exhaustively find reasons
> the code or plan creates bugs or does not work. Return findings only:
> severity, failing scenario or repro. No fixes, no praise. An empty list must
> state what you attacked and why it held.

Dedupe findings across reviewers. Fix every in-scope critical-severity finding;
critical-severity findings cannot be deferred. Fix or explicitly defer
non-critical findings with a stated reason. Verify fixes with targeted tests
and required validation, including security regressions for critical findings.
Any unresolved in-scope critical finding blocks handoff or publication.
Fixes, feedback, and rebases do not restart adversarial review or reset its
count. A newly implemented stack layer gets its own single round; repairing
an existing layer does not create a new scope.

When a finding is outside the issue's acceptance criteria, record it in a
linked backlog issue if it is actionable. Out-of-scope findings do not extend
or block the current implementation. After the bounded review is complete,
rerun the checks required by the Validation section and report the round count
and every finding's disposition. If tool policy cannot provide the reviewers
the tier requires—two independent reviewers for a two-reviewer change, one
otherwise—stop before final handoff or publication and report the blocker.

For an authorized stack, complete the current layer's TDD, scoped review,
validation, preflight, signed commit, local signature verification, draft PR,
template, and GitHub provenance before implementing the next layer. Do not
build later layers in one combined working tree and split them afterward unless
the user explicitly requires atomic publication. Feedback that changes a
published lower layer invalidates affected upper-layer validation evidence: preserve any in-progress upper work, update the lower
layer, cascade-rebase the upper layers, rerun their affected checks and
signature verification, refresh each affected PR's acceptance-evidence table
and review dispositions, and refresh GitHub provenance after pushing. Keep
whole-stack validation at the final layer.

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
