# ADR 0010: Storybook-First Visual Regression Strategy

Status: Accepted
Date: 2026-06-20

## Context

Issue #23 expands the M1 token foundation into reusable portal components for
catalog, loops, runs, artifacts, approvals, validation, deployments, and shared
states. These components need a repeatable visual review surface before the
dependent app surfaces in #8, #9, #12, and #14 stabilize enough for durable
screenshot baselines.

The repository already uses Storybook as the component review surface,
`@storybook/addon-a11y` for per-story accessibility inspection, and Playwright
with axe for composed browser accessibility coverage. Adding an external
visual-regression SaaS, broad screenshot baseline system, or custom Storybook
iframe crawler now would create maintenance churn while the component APIs and
composed surfaces are still changing.

## Decision

Loopworks will use a Storybook-first visual regression strategy for M1
component build-out:

1. Reusable components must have Storybook stories under the active portal
   taxonomy before they are composed into dashboard surfaces.
2. Storybook remains the canonical per-component review surface. The a11y addon
   is the preferred place to inspect story-level accessibility in light and dark
   themes; a future Storybook-native runner should make those checks fail CI.
3. Playwright axe checks remain focused on composed app surfaces rather than
   duplicating Storybook's story inventory.
4. Human visual review will use the same Storybook stories plus the live
   dashboard before commits are made.
5. Durable screenshot baselines are deferred until catalog, deployment, run,
   approval, and validation surfaces stabilize.

No external visual-regression service is added for M1.

## Consequences

Storybook remains the canonical review surface for reusable UI, and axe provides
story-level accessibility evidence in both themes. Playwright continues to
cover the assembled user-facing flows where route wiring, layout, and
interaction regressions are most likely. This keeps local validation
deterministic without introducing visual baseline noise while the components are
still being extracted.

The trade-off is that per-story a11y is not yet a CI failure until the
Storybook-native runner is wired into the validation script, and pixel-level
regressions remain a manual review risk until the stabilized surfaces get
screenshot baselines.

## Validation

1. New M1 component stories build with `bun run storybook:build`.
2. Playwright axe checks pass on composed app surfaces.
3. `bun run validate` remains the aggregate local quality gate.
4. Human review checks the Storybook stories and dashboard before commits.

## Follow-Ups

1. Add screenshot baselines for stabilized catalog, deployment, run, approval,
   and validation surfaces after their data contracts settle.
2. Add Storybook's native component/a11y runner to CI once the project is ready
   to take on that dependency and configuration.
3. Revisit whether a local screenshot diff tool is enough before considering an
   external hosted visual-regression service.
