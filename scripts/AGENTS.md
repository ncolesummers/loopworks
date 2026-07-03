# Script Guide

## Scope

This guide applies to repository scripts and bootstrap tooling under `scripts/`.

## Rules

1. Prefer deterministic, idempotent scripts with explicit dry-run or check modes
   when they mutate external or repository state.
2. Keep scripts typed and runnable with Bun unless the repository adopts another
   standard for that script class.
3. Print actionable failures and avoid noisy success output.
4. Do not read or print secrets beyond the minimum required validation.
5. Add focused unit tests for parsing, discovery, generation, and validation
   behavior.
