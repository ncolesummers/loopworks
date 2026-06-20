# ADR 0008: Agent Instruction Scope And Sync

Status: Accepted
Date: 2026-06-20

## Context

Loopworks is used by multiple coding agents. The repository previously kept
duplicated root-level `AGENTS.md` and `CLAUDE.md` content, which made drift
likely and pushed area-specific guidance into every session. Codex supports
directory-scoped `AGENTS.md` files, Claude Code reads `CLAUDE.md` files and can
import `AGENTS.md`, and the AGENTS.md standard encourages nested guides for
subprojects.

## Decision

Loopworks will use `AGENTS.md` as the canonical authored instruction surface.
Root `AGENTS.md` stays thin and routes agents to nested guides. Directory-level
`AGENTS.md` files hold scoped rules near the code or docs they govern.

Every canonical `AGENTS.md` must have a sibling generated `CLAUDE.md` shim. The
only active shim content is `@AGENTS.md`; maintainer notes live in HTML comments
that Claude strips from context. Maintainers update `AGENTS.md` files by hand
and run `bun run agent-docs:sync`; validation runs `bun run agent-docs:check`
and fails on missing, stale, orphaned, symlinked, or incorrectly cased
instruction files.

## Consequences

This avoids duplicated instruction content and keeps startup context smaller for
root-level work. Claude-specific rule systems such as `.claude/rules/` remain
out of scope for v1 because they would create another sync surface.

Agents must read the closest relevant directory guide before touching a scoped
area. CI and precommit now include a fast sync check so drift is caught before
review.

## Validation

1. `bun run agent-docs:check` passes locally and in CI.
2. `bun run validate` includes the agent-docs sync check before Markdownlint.
3. Unit tests cover discovery, ignored directories, generated shim content,
   drift detection, symlink rejection, and write behavior.
4. Root `AGENTS.md` remains a routing and universal-rules document.

## Follow-Ups

1. Revisit whether Claude-specific `.claude/rules/` adds enough value after the
   directory-scoped `AGENTS.md` pattern has been used in real work.
2. Add new nested `AGENTS.md` files only when a directory has durable,
   recurring rules that do not belong in root guidance.
