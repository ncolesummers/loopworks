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
4. Use Storybook-native component and a11y tooling for story-level reusable UI
   checks when configured; do not add bespoke Storybook iframe crawlers for
   inventory-only assertions.
5. Use explicit fixtures. Do not add silent production fallbacks.
6. Keep e2e tests runnable with `LOOPWORKS_AUTH_BYPASS=true` unless the test is
   specifically covering real auth.
7. For auth allowlist or session-policy changes, add focused unit tests under
   `tests/unit/auth/` that cover allow, deny, and fail-closed paths before
   editing production code.

## Validation

Include `bun run test` and relevant Playwright, Storybook, or Storybook-native
component checks in final validation evidence.
For auth changes, run the focused auth tests, `bun run typecheck`, and
`bun run format:check` before the final aggregate validation.
