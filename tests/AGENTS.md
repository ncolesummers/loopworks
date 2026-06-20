# Test Guide

## Scope

This guide applies to Vitest, Playwright, Storybook validation, fixtures, and
test helpers under `tests/`.

## Rules

1. Keep tests close to the behavior and risk being changed.
2. Use Vitest for shared logic, auth, GitHub/Vercel integration, approvals,
   manifests, observability, and agent contracts.
3. Use Playwright for user-visible workflows and persona-derived acceptance
   scenarios.
4. Use explicit fixtures. Do not add silent production fallbacks.
5. Keep e2e tests runnable with `LOOPWORKS_AUTH_BYPASS=true` unless the test is
   specifically covering real auth.

## Validation

Include `bun run test` and relevant Playwright or Storybook checks in final
validation evidence.
