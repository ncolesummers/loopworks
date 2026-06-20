# Design Review Checklist

Use this checklist before closing any issue that creates or modifies a shared UI
component, design token, or page surface. The automated gate is
`bun run validate` (typecheck + unit tests + Storybook build + Playwright + axe
a11y). Manual checks below cover what automation does not fully enforce.

## Tokens and Primitives

- [ ] Uses design tokens from `src/app/globals.css` / `tailwind.config.ts` — no
  hardcoded color values or one-off utility color classes.
- [ ] Builds on existing shared primitives (Button, Badge, Card, Table, etc.)
  before introducing a new component.
- [ ] No inline `style` blocks containing color or spacing values that belong in
  the token system.

## Status Vocabulary

- [ ] Status states use `StatusBadge` with a value from the `Status` type defined
  in `src/components/ui/status-badge.tsx` — no ad-hoc state styling.
- [ ] New states are added to `STATUS_META` in `status-badge.tsx` and mapped to
  an existing tone family before any UI uses them.

## Accessibility and Contrast

- [ ] Passes axe contrast check in both light and dark modes.
- [ ] All interactive elements are keyboard-operable (Tab, Enter/Space, Escape
  where applicable).
- [ ] Focus ring is visible in both modes and uses the `ring` token (brand
  accent).
- [ ] Meaningful non-text elements carry an appropriate `aria-label` or visible
  text label.

## Layout Stability

- [ ] Dimensions are stable across loading, empty, error, and populated states —
  no layout shift between state transitions.
- [ ] Responsive and usable at mobile (≤640 px), laptop (≥1024 px), and desktop
  (≥1280 px) widths.

## Motion

- [ ] Color transitions are approximately 150ms; spin or pulse animation is used
  only for in-progress states (running, building, loading).
- [ ] All motion is guarded by `prefers-reduced-motion` via `motion-reduce:`
  utilities — no decorative animation runs unconditionally.

## Storybook Coverage

- [ ] New or modified shared components have stories for: default state, disabled
  state, and loading / empty / error states where those states exist.
- [ ] Story titles follow the active taxonomy: `UI/Primitives/*`,
  `Portal/Shell/*`, `Foundations/Colors`, `Foundations/Typography`, `States/*`.

## Automated Gate

- [ ] `bun run validate` passes locally before the PR is marked ready for review.
