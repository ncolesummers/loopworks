import {
  CircleDashed,
  FileJson2,
  FolderOpen,
  GitBranch,
  type LucideIcon,
  Monitor,
  PlugZap,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import type { Status } from "@/components/ui/status-badge";
import {
  type FirstRunStage,
  type FirstRunState,
  isFirstRunOnboarding,
  isFirstRunUnavailable,
} from "@/lib/onboarding/first-run-state";

/**
 * The portal's empty-state inventory.
 *
 * ADR 0019 fixes the rule this module enforces: an empty state must not name a next step it
 * cannot route to, and first-run emptiness must render distinctly from an unavailable data
 * source. Each entry therefore either carries an `action` that routes somewhere real, or a
 * `terminal` reason recording why no next step exists. The type makes "neither" unwritable,
 * and `tests/unit/portal/empty-state-inventory.test.ts` holds every portal component to
 * declaring its empty states here rather than hand-rolling them.
 */
export type PortalEmptyStateAction =
  | {
      /** Set for hrefs that leave the app; the renderer opens these in a new tab. */
      external?: true;
      href: string;
      kind: "link";
      label: string;
    }
  | {
      kind: "reset";
      label: string;
    };

type PortalEmptyStateBase = Readonly<{
  detail: string;
  icon?: LucideIcon;
  id: string;
  /** The surface this state belongs to, for inventory reporting. */
  surface: string;
  status: Status;
  title: string;
}>;

export type PortalEmptyStateSpec = PortalEmptyStateBase &
  Readonly<
    | {
        action: PortalEmptyStateAction;
        /** A documented alternate route to the same step, for a primary action that can dead-end. */
        secondaryAction?: PortalEmptyStateAction;
        terminal?: never;
      }
    /** Why this state has no next step. Required, so "no action" is always a stated decision. */
    | { action?: never; secondaryAction?: never; terminal: string }
  >;

function defineEmptyStates<T extends Record<string, PortalEmptyStateSpec>>(specs: T): Readonly<T> {
  return Object.freeze(specs);
}

export const PORTAL_EMPTY_STATES = defineEmptyStates({
  // --- Onboarding stages (ADR 0019), shared by every surface that can be empty because the
  // operator has not finished activating. Each routes to the step it names.
  "onboarding-no-installation": {
    action: {
      href: "/api/github/install",
      kind: "link",
      label: "Connect the GitHub App",
    },
    detail:
      "Install the Loopworks GitHub App to let the portal read repositories, issues, and checks. Already installed it on GitHub? Connect the existing installation instead.",
    icon: PlugZap,
    id: "onboarding-no-installation",
    // GitHub sends the operator to its configure page instead of the Setup URL when the account
    // already has the App, so the install action alone dead-ends for them (#151). Every surface
    // that offers installation must offer the reconciliation route beside it.
    secondaryAction: {
      href: "/api/github/install/reconcile",
      kind: "link",
      label: "Find existing installation",
    },
    status: "empty",
    surface: "onboarding",
    title: "No GitHub App installation connected",
  },
  "onboarding-no-repositories": {
    action: {
      href: "/settings/repositories",
      kind: "link",
      label: "Select repositories",
    },
    detail:
      "The GitHub App is installed. Select the repositories the portal should track to populate this surface.",
    icon: GitBranch,
    id: "onboarding-no-repositories",
    status: "empty",
    surface: "onboarding",
    title: "No repositories selected yet",
  },
  "onboarding-no-loops": {
    action: {
      href: "/loops/register",
      kind: "link",
      label: "Register a loop",
    },
    detail:
      "Repositories are tracked but no loop contract is registered against them yet. Register one to make its triggers, gates, and approvals visible.",
    icon: Workflow,
    id: "onboarding-no-loops",
    status: "empty",
    surface: "onboarding",
    title: "No loops registered",
  },

  // --- Unavailable source state. ADR 0019 forbids a connection call to action on a failed
  // read: the portal cannot claim the operator has anything to connect when it could not read.
  "portal-unavailable": {
    detail: "The portal could not read its data store, so this surface cannot report state.",
    icon: CircleDashed,
    id: "portal-unavailable",
    status: "failed",
    surface: "portal",
    terminal:
      "The read failed, so the portal cannot tell first-run emptiness from missing data and must not offer a connection step (ADR 0019).",
    title: "Portal data unavailable",
  },

  // --- Operator-caused emptiness, reversible in place.
  "catalog-no-filter-matches": {
    action: {
      kind: "reset",
      label: "Clear filters",
    },
    detail:
      "The catalog is tracking repositories, but none match the current search and health filters.",
    icon: FolderOpen,
    id: "catalog-no-filter-matches",
    status: "empty",
    surface: "catalog",
    title: "No repositories match the current filters",
  },

  // --- Terminal states: real emptiness with no operator step the portal can route to.
  "loop-registry-no-loops": {
    detail:
      "Loop rows are mirrored from GitHub issue sync and appear once sync writes durable state.",
    icon: Workflow,
    id: "loop-registry-no-loops",
    status: "empty",
    surface: "dashboard",
    terminal:
      "These rows mirror synced GitHub issues rather than operator input; registering a loop is a separate surface and is offered by onboarding-no-loops.",
    title: "No loops tracked",
  },
  "timeline-no-events": {
    detail: "Run events appear after a registered loop executes.",
    icon: FileJson2,
    id: "timeline-no-events",
    status: "empty",
    surface: "dashboard",
    terminal: "Runs are produced by loop execution, not by an operator action in the portal.",
    title: "No timeline events recorded",
  },
  "artifacts-none": {
    detail: "Artifacts are written by run steps and appear alongside the run that produced them.",
    icon: FileJson2,
    id: "artifacts-none",
    status: "empty",
    surface: "dashboard",
    terminal: "Artifacts are a run output; there is no operator step that creates one.",
    title: "No artifacts recorded",
  },
  "run-steps-none": {
    detail: "Steps appear as the run records them.",
    icon: FileJson2,
    id: "run-steps-none",
    status: "empty",
    surface: "runs",
    terminal: "A run's steps are written by the run itself; the operator cannot add one.",
    title: "No run steps recorded",
  },
  "run-approvals-none": {
    detail: "Approvals appear here once this run reaches a gate that requires one.",
    icon: ShieldCheck,
    id: "run-approvals-none",
    status: "empty",
    surface: "runs",
    terminal: "An approval is raised by the run reaching a gate, not opened by the operator.",
    title: "No approvals recorded",
  },
  "runs-none": {
    detail: "Run records appear after a registered loop executes.",
    icon: FileJson2,
    id: "runs-none",
    status: "empty",
    surface: "runs",
    terminal: "Runs are produced by loop execution, not by an operator action in the portal.",
    title: "No runs available",
  },
  "deployments-none": {
    detail: "Deployment and preview records appear after the first Vercel webhook sync.",
    icon: Monitor,
    id: "deployments-none",
    status: "empty",
    surface: "deployments",
    terminal: "Deployments arrive from Vercel webhooks; the portal cannot create one.",
    title: "No deployments available",
  },
  "approval-none": {
    detail: "Approval gates appear after a loop or run requests review.",
    icon: ShieldCheck,
    id: "approval-none",
    status: "empty",
    surface: "approvals",
    terminal: "An approval gate is raised by a run, not opened by the operator.",
    title: "No approval gates available",
  },
  "validation-results-none": {
    detail: "Deterministic checks appear here after the first validation run.",
    icon: ShieldCheck,
    id: "validation-results-none",
    status: "empty",
    surface: "validation",
    terminal: "Validation results are a run output; there is no operator step that creates one.",
    title: "No validation results yet",
  },
  "validation-gates-none": {
    detail:
      "Gates are declared in the repository's loop manifest and appear once a run reports them.",
    icon: ShieldCheck,
    id: "validation-gates-none",
    status: "empty",
    surface: "validation",
    terminal:
      "Gate configuration lives in the repository manifest, not in the portal, so there is no in-portal destination to route to.",
    title: "No validation gates yet",
  },
  "fixture-only-surface": {
    detail:
      "This surface is backed by local development fixtures only and fails closed in production until it is wired to a durable store.",
    icon: CircleDashed,
    id: "fixture-only-surface",
    status: "empty",
    surface: "production-gate",
    terminal:
      "The surface has no durable store in production yet; wiring one is development work, not an operator step.",
    title: "Unavailable in production",
  },

  // --- GitHub settings (#151). The install route can dead-end, so it carries the reconcile
  // route beside it exactly as the onboarding stage does.
  "github-settings-no-installation": {
    action: {
      href: "/api/github/install",
      kind: "link",
      label: "Connect GitHub App",
    },
    detail: "Install the Loopworks GitHub App before selecting repositories.",
    icon: PlugZap,
    id: "github-settings-no-installation",
    secondaryAction: {
      href: "/api/github/install/reconcile",
      kind: "link",
      label: "Find existing installation",
    },
    status: "empty",
    surface: "settings",
    title: "No installation connected",
  },
  "github-settings-none": {
    detail: "Settings appear once the portal has read the GitHub integration contract.",
    icon: CircleDashed,
    id: "github-settings-none",
    status: "empty",
    surface: "settings",
    terminal:
      "The settings projection is derived from the store rather than entered by the operator, so there is no step to route to.",
    title: "No GitHub settings projected",
  },

  // --- Repository selection (#125). Already routed; inventoried so the guard covers the file.
  "repository-selection-not-connected": {
    action: {
      href: "/api/github/install",
      kind: "link",
      label: "Connect GitHub App",
    },
    detail:
      "Install the Loopworks GitHub App before selecting repositories for the catalog. Already installed it on GitHub? Connect the existing installation instead.",
    icon: PlugZap,
    id: "repository-selection-not-connected",
    secondaryAction: {
      href: "/api/github/install/reconcile",
      kind: "link",
      label: "Find existing installation",
    },
    status: "empty",
    surface: "repository-selection",
    title: "No GitHub App installation connected",
  },
  "repository-selection-no-access": {
    action: {
      external: true,
      // Per-installation; the view substitutes the installation id before rendering.
      href: "https://github.com/settings/installations",
      kind: "link",
      label: "Adjust repository access on GitHub",
    },
    detail:
      "The installation is connected but grants access to no repositories. Grant it access to at least one repository, then reload this page.",
    icon: GitBranch,
    id: "repository-selection-no-access",
    status: "empty",
    surface: "repository-selection",
    title: "No repositories reachable",
  },

  // --- Loop registration (#126). Already routed; inventoried so the guard covers the file.
  "loop-registration-no-repositories": {
    action: {
      href: "/settings/repositories",
      kind: "link",
      label: "Select repositories",
    },
    detail:
      "A loop is scoped to a repository, so select at least one repository from the connected installation first.",
    icon: GitBranch,
    id: "loop-registration-no-repositories",
    status: "empty",
    surface: "loop-registration",
    title: "No repositories tracked yet",
  },
} satisfies Record<string, PortalEmptyStateSpec>);

export type PortalEmptyStateId = keyof typeof PORTAL_EMPTY_STATES;

/** Generic so the returned `id` keeps its literal type, which `data-empty-state` props require. */
export function portalEmptyState<Id extends PortalEmptyStateId>(
  id: Id,
): (typeof PORTAL_EMPTY_STATES)[Id] {
  return PORTAL_EMPTY_STATES[id];
}

const onboardingStateIds = {
  "no-installation": "onboarding-no-installation",
  "no-loops": "onboarding-no-loops",
  "no-repositories": "onboarding-no-repositories",
} as const satisfies Record<FirstRunStage, PortalEmptyStateId>;

/**
 * Pick the empty state a surface should render, composing the source state with the onboarding
 * stage exactly as ADR 0019 requires: an unavailable read short-circuits before any record is
 * inspected and never renders a connection call to action.
 *
 * `stages` lists the onboarding stages this surface can honestly speak to. A surface that is
 * empty for a reason no listed stage explains falls back to its own spec, so a stage is never
 * reported as the cause of an emptiness it does not actually cause. A surface with no onboarding
 * explanation at all omits `stages` and gets its terminal spec, or the unavailable spec on a
 * failed read - which is how every non-onboarding surface distinguishes the two.
 *
 * `activated` deliberately takes the fallback rather than an onboarding stage. It is only
 * reachable when `firstRun` was derived from a different read than the collection being
 * rendered, and claiming an activation step in that case would name a step the operator has
 * already completed.
 */
export function resolvePortalEmptyState(
  input: Readonly<{
    fallback: PortalEmptyStateId;
    firstRun?: FirstRunState;
    stages?: readonly FirstRunStage[];
  }>,
): PortalEmptyStateSpec {
  const { fallback, firstRun, stages = [] } = input;

  if (firstRun === undefined) {
    return portalEmptyState(fallback);
  }

  if (isFirstRunUnavailable(firstRun)) {
    // Indexed directly rather than through `portalEmptyState`, so the spread keeps the literal
    // terminal type and cannot silently widen into the action-bearing arm of the union.
    // The read error is the only truthful detail here; the spec's own copy is the fallback for
    // a caller with no reason string.
    return { ...PORTAL_EMPTY_STATES["portal-unavailable"], detail: firstRun.reason };
  }

  if (isFirstRunOnboarding(firstRun) && stages.includes(firstRun.stage)) {
    return portalEmptyState(onboardingStateIds[firstRun.stage]);
  }

  return portalEmptyState(fallback);
}
