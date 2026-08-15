# Documentation Guide

## Scope

This guide applies to product docs, architecture docs, personas, security
review, loop manifests, and contributor-facing documentation under `docs/`.

## Rules

1. Update the persona/test-scenario matrix when intended user workflows change.
2. Create durable GitHub issues directly (`gh issue create` or the issue-form
   templates) when new foundational work needs tracking.
3. Use ADR proposals or issue comments for durable decisions.
4. Update `docs/security-review.md` when auth or session behavior changes the
   durable security expectation.
5. Keep docs Markdownlint-compliant.
6. Use unit tests for documentation only when they protect a machine-enforced
   contract, such as generated artifacts, resolvable links or symlinks,
   schemas, or executable commands. Do not pin headings, phrases, or editorial
   wording merely to prove that guidance exists; use Markdownlint, focused
   review, and acceptance evidence for prose. Exact text belongs in a test only
   when another tool consumes that text as an interface.

## Routing

Use `docs/adr/AGENTS.md` for ADR-specific rules.

Put operator procedures that touch live environments in `docs/runbooks/`. State
the target environment at the top, and mark any destructive or secret-handling
step as such where it appears, not only in a preamble.
