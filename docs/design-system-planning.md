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

## Issue #23 Component Build-Out Conventions

The M1 reusable component pass composes the token foundation into fixture-backed
portal components before the backing data surfaces are complete.

1. Components use `StatusBadge` and `STATUS_META` for all state language.
2. Storybook is the canonical component review surface for default, disabled,
   loading, empty, and error variants.
3. Storybook-native accessibility checks are the target per-story a11y gate;
   until that runner is wired into CI, `storybook:build` verifies the component
   inventory and Playwright axe stays focused on composed app surfaces.
4. Dashboard integration should consume the reusable components instead of
   re-implementing table rows, cards, timelines, approval panels, validation
   summaries, or state blocks inline.

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

## Resolved Decisions (M1)

The following answers resolve the open questions above. The durable record is
`docs/adr/0009-design-system-direction-and-tokens.md`.

### Dedicated Planning Questions — Answered

1. **Feel:** Geist-inspired engineering control plane — calm, dense, precise.
   Not a marketing page or decorative dashboard. "Functional over decorative."

2. **Color roles:** Monochrome neutral base (hue 0 / 0% saturation) plus one
   restrained blue accent. Four semantic status families each own four roles
   (DEFAULT, `-foreground`, `-muted`, `-border`): `success`, `warning`,
   `danger`, `info`. The neutral status family reuses shared `muted`,
   `muted-foreground`, and `border` tokens. Color appears only for semantic
   status or the single brand accent.

3. **Density:** Tailwind default spacing scale — dense but readable. Targets
   laptop and desktop operators without reinventing the scale.

4. **First Loopworks-branded component:** `StatusBadge` in
   `src/components/ui/status-badge.tsx`, which centralizes the status
   vocabulary as a `STATUS_META` map and `Status` type. Shell, card, table,
   and button primitives follow.

5. **Status badge vocabulary:** Twenty states — `loading`, `empty`, `disabled`,
   `pending`, `queued`, `running`, `blocked`, `failed`, `succeeded`, `skipped`,
   `needsApproval`, `approved`, `rejected`, `done`, `production`, `preview`,
   `ready`, `building`, `errored`, `canceled` — all rendered through
   `STATUS_META`. No ad-hoc state styling outside this map.

6. **Run timeline density vs. artifact detail:** Deferred to the run-timeline
   component build-out (see Follow-Ups in ADR 0009).

7. **Risk vs. error distinction:** `warning` tone for risk/gate states
   (blocked, needsApproval) versus `danger` tone for terminal failures
   (failed, rejected, errored). Visually distinct families, not shades of
   the same hue.

8. **Storybook taxonomy:** Active — `UI/Primitives/*`, `Portal/Shell/*`,
   `Foundations/Colors`, `Foundations/Typography`, `States/*`. Future (added
   as surfaces are built) — `Portal/Catalog`, `Portal/Loops`, `Portal/Runs`,
   `Portal/Approvals`, `Portal/Vercel`.

9. **Design review checklist:** See `docs/design-review-checklist.md`. The
   automated gate is `bun run validate`.

### Token Decisions — Resolved

1. **Color roles:** Neutral ramp (`background`, `foreground`, `card`,
   `card-foreground`, `popover`, `popover-foreground`, `primary`,
   `primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
   `muted-foreground`, `accent`, `accent-foreground`, `border`, `input`) plus
   `brand`, `brand-foreground`, `ring` (= brand).

2. **Workflow roles:** pending/queued/skipped/canceled/disabled/empty →
   neutral; running → info; blocked/needsApproval → warning;
   failed/rejected → danger; succeeded/approved/done → success.

3. **Deployment roles:** production/ready → success; building → info;
   errored → danger; canceled → neutral; preview → unassigned at M1.

4. **Typography:** Mona Sans (UI text) + Monaspace Neon (IDs, SHAs, run
   logs). Both GitHub SIL OFL typefaces, self-hosted via `next/font/local`
   from `src/lib/fonts.ts`.

5. **Spacing:** Tailwind defaults — no custom scale.

6. **Radius and border:** `--radius: 0.5rem`. No additional border-width
   tokens.

7. **Focus ring:** `ring` token equals the brand blue accent. Keyboard
   navigation requires a visible focus ring on all interactive elements.

8. **Motion:** ~150ms ease color transitions on interactive elements;
   spin/pulse only for in-progress states; all motion guarded by
   `prefers-reduced-motion` via `motion-reduce:` utilities.
