# ADR 0005: ShadCN/UI As Component Foundation

Status: Superseded by 0009
Date: 2026-06-20
Superseded: 2026-06-20

> The component-foundation decision from this ADR is carried forward and remains
> in force in [ADR 0009](0009-design-system-direction-and-tokens.md), which now
> owns design direction, tokens, and the ShadCN/UI component-foundation choice.
> The visual-regression strategy lives in [ADR 0010](0010-storybook-first-visual-regression-strategy.md).

## Context

Loopworks needs a professional developer portal quickly, but the UI must not settle into generic defaults. The app needs accessible primitives, consistent state vocabulary, Storybook coverage, and a design-system direction that fits an operational control plane.

## Decision

Loopworks will use ShadCN/UI as the component foundation. ShadCN primitives provide the starting point for buttons, badges, cards, tables, tabs, forms, dialogs, switches, alerts, skeletons, dropdowns, and related controls.

The temporary M0 theme is not the final brand. M1 must include a dedicated design-system planning pass for tokens, density, layout rules, component conventions, status language, and Storybook taxonomy.

## Consequences

This gives the project accessible primitives and a practical path to feature-complete MVP screens. It also requires deliberate token work so Loopworks becomes a clear, dense, operational product instead of a collection of default components.

Reusable components should be developed and reviewed in Storybook before broad use in app surfaces.

## Validation

1. Shared components have stories for important states.
2. UI work uses existing primitives before inventing one-off controls.
3. Design-system planning defines semantic tokens for workflow, validation, approval, and deployment states.
4. Playwright and a11y checks cover user-visible flows.

## Follow-Ups

1. ~~Run the dedicated design-system planning chat before broad M2/M3 UI expansion.~~ Resolved by [ADR 0009](0009-design-system-direction-and-tokens.md).
2. ~~Define the first durable token set and status vocabulary.~~ Resolved by [ADR 0009](0009-design-system-direction-and-tokens.md).
3. ~~Add Storybook taxonomy and design review checklists to issue acceptance criteria.~~ Resolved: Storybook taxonomy in [ADR 0009](0009-design-system-direction-and-tokens.md); the design-review gate lives in `docs/design-review-checklist.md`.
4. ~~Add visual regression strategy once key surfaces stabilize.~~ Resolved by [ADR 0010](0010-storybook-first-visual-regression-strategy.md).
