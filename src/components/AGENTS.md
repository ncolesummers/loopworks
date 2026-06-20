# Component Guide

## Scope

This guide applies to reusable UI components and component-adjacent stories
under `src/components/`.

## Rules

1. Use ShadCN/UI as the component foundation until the design-system planning
   issue says otherwise.
2. Keep dashboard surfaces dense, stable, and operational. Avoid
   marketing-style pages inside the app.
3. Use lucide icons for icon buttons when an appropriate icon exists.
4. Prefer familiar controls: toggles for binary settings, tabs for views,
   sliders/inputs for numeric values, and menus for option sets.
5. Ensure text fits inside controls across mobile and desktop viewports.
6. Keep reusable states accessible and keyboard-usable.

## Tests

Reusable components need Storybook stories for important states. User-visible
workflow changes need Playwright coverage and accessibility checks where
relevant.
