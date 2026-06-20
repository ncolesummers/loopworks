# Codex Project Config Guide

## Scope

This guide applies to project-local Codex configuration and hooks under
`.codex/`.

## Rules

1. Keep project hooks in `.codex/hooks.json`; do not add inline `[hooks]`
   tables in `.codex/config.toml`.
2. Hooks should be advisory by default. Hard-block only mechanical repo-safety
   violations such as generated instruction shims or build artifacts.
3. Hook scripts must tolerate missing or unfamiliar payload fields and resolve
   repo paths from the git root.
4. Do not run full validation from lifecycle hooks. Keep deterministic
   validation in package scripts, CI, and `pre-k`.
5. Add focused tests when hook behavior changes.
