# Loopworks Design System Planning

## Purpose

Loopworks starts with ShadCN/UI for speed, accessibility, and familiar primitives, but it should not stay visually generic. This decision is captured in `adr/0005-shadcn-ui-as-component-foundation.md`. The product needs an early dedicated design-system planning chat before broad UI expansion. This document defines the questions, deliverables, and acceptance criteria for that issue.

## Timing

Design-system direction belongs in M1, before the repo catalog, loop registry, run timeline, and Vercel views become too broad. The M0 scaffold may use a temporary ShadCN theme, but M1 should decide the first durable token set and interface conventions.

## Product Context

Loopworks is an operator portal for agentic software delivery. It should feel like a serious engineering control plane:

1. Dense, scannable, and calm.
2. Built for repeated daily use.
3. Focused on state, evidence, and next actions.
4. Clear about risk and approval gates.
5. Not a marketing page and not a decorative dashboard.

## Initial Principles

1. Functional over decorative.
2. Dense but readable surfaces.
3. Stable dimensions for tables, cards, timelines, status badges, and controls.
4. Strong state language for loading, empty, disabled, pending, running, blocked, failed, approved, and done.
5. Familiar icons for common actions.
6. Text labels for business-critical actions such as approve, reject, trigger, retry, cancel, and create PR.
7. Avoid one-off styling where a token or shared primitive should exist.
8. Treat Storybook as the review surface for reusable components.

## Dedicated Planning Questions

1. What should Loopworks feel like: internal control plane, developer portal, command center, or something else?
2. What color roles should be durable across run states, validation results, approval states, and deployment states?
3. What density should the dashboard target for laptop and desktop operators?
4. Which ShadCN primitives become Loopworks-branded components first?
5. What should status badges communicate visually and textually?
6. How should run timelines balance event density with artifact detail?
7. How should risk states look different from ordinary error states?
8. What is the Storybook taxonomy for primitives, composed dashboard components, workflow states, and page slices?
9. What design review checklist must be satisfied before UI issues close?

## Token Decisions To Make

1. Color roles: background, surface, elevated surface, border, text, muted text, accent, focus, destructive, warning, success, info.
2. Workflow roles: pending, queued, running, blocked, failed, succeeded, skipped, needs approval, approved, rejected.
3. Deployment roles: production, preview, ready, building, errored, canceled.
4. Typography scale for shell, tables, cards, compact metadata, and run logs.
5. Spacing scale for dense dashboards.
6. Radius and border conventions.
7. Focus ring and keyboard navigation conventions.
8. Motion policy for state changes and timelines.

## Component Priorities

1. App shell and navigation.
2. Status badge and state pill.
3. Repo catalog row/card.
4. Loop card and loop toggle.
5. Run timeline item.
6. Artifact link/list item.
7. Approval gate panel.
8. Validation result summary.
9. Deployment summary row/card.
10. Empty, loading, error, disabled, and unauthorized states.

## Storybook Taxonomy

1. `UI/Primitives`: ShadCN-based low-level controls.
2. `Portal/Shell`: navigation and page layout.
3. `Portal/Catalog`: repo/service catalog components.
4. `Portal/Loops`: loop registry, toggles, manifests, gates.
5. `Portal/Runs`: timelines, artifacts, validation summaries.
6. `Portal/Approvals`: approval gates and audit states.
7. `Portal/Vercel`: deployment and preview summaries.
8. `States`: loading, empty, error, disabled, failed, pending, approved.

## Acceptance Criteria For M1

1. Core tokens and temporary-vs-durable theme stance are documented.
2. Storybook taxonomy is agreed and reflected in file organization.
3. Shared primitives have stories with at least default, disabled, loading/error where relevant, and stateful variants.
4. Shell and dashboard layout work at mobile, laptop, and desktop widths.
5. Status vocabulary is consistent across loops, runs, approvals, validation, and deployments.
6. A design review checklist exists for future UI work.

## Follow-Up Prompt Shape

Use a dedicated chat to decide:

1. Brand and tone.
2. Token palette and semantic roles.
3. Layout density and navigation model.
4. Component taxonomy and naming.
5. Storybook review rules.
6. Design QA expectations for Playwright screenshots and accessibility checks.
