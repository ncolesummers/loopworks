# ADR 0009: Design System Direction And Tokens

Status: Accepted
Date: 2026-06-20

## Context

ADR 0005 accepted ShadCN/UI as the component foundation and flagged the M0 theme
as temporary. M0 shipped the shadcn defaults: blue primary at `221 83% 53%`,
Inter font, navy-tinted dark mode, badge variants hardcoding Tailwind utility
classes (`emerald`, `amber`, `rose`), and non-functional dark mode toggle. Before
the repo catalog, loop registry, run timeline, and Vercel views expanded beyond
the initial scaffold, Loopworks needed a dedicated design-system planning pass to
establish the first durable token set, status vocabulary, and interface
conventions appropriate for an operational control plane.

## Decision

### Brand and Feel

Loopworks M1 is Geist-*inspired* — calm, dense, precise engineering control
plane. It deliberately does not use the literal Geist typeface, which now reads
as AI-generated boilerplate. The guiding principle is "functional over
decorative."

### Palette: Monochrome Plus One Accent

The color stance is a near-pure neutral base (Tailwind `neutral`-style values,
hue 0 / 0% saturation). The primary action color is near-black in light mode and
near-white in dark mode — "any color so long as it's black" (Henry Ford).
Exactly one restrained brand accent, a blue, is permitted: it appears only on
links, focus rings, and the `info` semantic status. All other color use is
restricted to semantic status signaling.

Both light and dark modes are first-class and fully functional, implemented via
`next-themes` using the class strategy with a ModeToggle component.

### Typography

UI text uses Mona Sans and monospace content (IDs, SHAs, run logs) uses
Monaspace Neon. Both are GitHub's own SIL OFL typefaces, chosen because they are
GitHub-native (fitting a GitHub-integrated factory) and distinctively non-generic.
Both are self-hosted via `next/font/local` and shared from `src/lib/fonts.ts`.

### Spacing and Radius

Tailwind's default spacing scale is reused without reinvention. The single radius
token is `--radius: 0.5rem`.

### Motion Policy

Motion is minimal but meaningful: approximately 150ms ease color transitions on
interactive elements; a subtle spin or pulse only for in-progress states
(running, building, loading); all motion guarded by `prefers-reduced-motion` via
`motion-reduce:` utilities. No decorative animation.

### Token System

Tokens are implemented as HSL CSS variables in `src/app/globals.css` and surfaced
through `tailwind.config.ts`.

**Neutral ramp** (each pair includes a `-foreground` companion where noted):
`background`, `foreground`, `card`, `card-foreground`, `popover`,
`popover-foreground`, `primary`, `primary-foreground`, `secondary`,
`secondary-foreground`, `muted`, `muted-foreground`, `accent`,
`accent-foreground`, `border`, `input`.

**Brand accent:** `brand`, `brand-foreground`, and `ring` (= brand).

**Semantic status families** — each carries four roles: the DEFAULT token (used
for dots and icons), `-foreground` (text on a muted fill), `-muted` (subtle
background fill), and `-border`. The neutral status family is an exception: it
reuses the shared `muted`, `muted-foreground`, and `border` tokens rather than
owning its own four-role set.

| Family | Tone roles | Approved status mappings |
| --- | --- | --- |
| `success` | `--success`, `-foreground`, `-muted`, `-border` | succeeded, approved, done, ready, production |
| `warning` | `--warning`, `-foreground`, `-muted`, `-border` | blocked, needsApproval |
| `danger` | `--danger`, `-foreground`, `-muted`, `-border` | failed, rejected, errored |
| `info` | `--info`, `-foreground`, `-muted`, `-border` | running, building, loading, preview |
| `neutral` | reuses `muted` / `muted-foreground` / `border` | pending, queued, skipped, canceled, disabled, empty |

A separate `--destructive` / `--destructive-foreground` pair is the solid action
color for destructive buttons (near-white text on a strong red); it is distinct
from the soft `danger` status family, which is used for pills and badges.

**Status vocabulary** is centralized in `src/components/ui/status-badge.tsx` as a
`STATUS_META` map and `Status` type. The full set of twenty states is:
`loading`, `empty`, `disabled`, `pending`, `queued`, `running`, `blocked`,
`failed`, `succeeded`, `skipped`, `needsApproval`, `approved`, `rejected`,
`done`, `production`, `preview`, `ready`, `building`, `errored`, `canceled`.

The tone mapping table above covers all twenty states; `loading` and `preview`
both map to the `info` tone.

### Storybook Taxonomy

Active namespaces reflect what exists at M1:

- `UI/Primitives/*` — ShadCN-based low-level controls
- `Portal/Shell/*` — navigation and page layout
- `Foundations/Colors` — token palette reference
- `Foundations/Typography` — type scale reference
- `States/*` — loading, empty, error, disabled, and stateful variants

Future namespaces, added as surfaces are built:
`Portal/Catalog`, `Portal/Loops`, `Portal/Runs`, `Portal/Approvals`,
`Portal/Vercel`.

### M0 to M1 Contrast

M0 used shadcn defaults: blue primary at `221 83% 53%`, Inter font, navy-tinted
dark mode, badge variants hardcoding Tailwind utility classes (`emerald`, `amber`,
`rose`), and a non-functional dark mode toggle. M1 replaces all of that with the
durable tokens above, Mona Sans and Monaspace Neon typography, the `STATUS_META`
centralized vocabulary, and fully functional light and dark modes.

## Consequences

The neutral-plus-one-accent stance makes color discipline enforceable: any color
outside the semantic status families or the single blue accent is a bug, not a
style choice. Centralizing status in `STATUS_META` means new states can be added
in one place and immediately inherit correct visual treatment across all surfaces.

Self-hosting GitHub fonts avoids network dependencies but adds an explicit font
asset maintenance obligation when upstream releases new versions.

Future UI expansion (catalog, loops, runs, approvals, Vercel) must use these
tokens and the status vocabulary before introducing new visual patterns.

## Validation

1. `bun run validate` (typecheck + unit tests + Storybook build + Playwright +
   axe a11y) is the automated gate for all design-system-affecting PRs.
2. Light and dark modes both pass axe contrast checks.
3. All interactive elements are keyboard-operable with a visible focus ring using
   the `ring` token.
4. `StatusBadge` covers every `Status` value without hardcoded utility color
   classes.
5. The design review checklist in `docs/design-review-checklist.md` is satisfied
   before closing a design-system-affecting issue.

## Follow-Ups

1. Build the deferred component set as follow-on UI issues: catalog row, loop
   card and toggle, run-timeline item, artifact list item, approval-gate panel,
   validation-result summary, and deployment summary card.
2. Define visual-regression strategy (screenshot baselines and diffing tool) once
   key surfaces stabilize.
3. Audit all existing components against the M1 token set and remove any
   remaining hardcoded utility color classes.
