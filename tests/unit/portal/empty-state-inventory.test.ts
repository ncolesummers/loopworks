import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { PORTAL_EMPTY_STATES, type PortalEmptyStateSpec } from "@/components/portal/empty-states";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const portalComponentDir = join(repoRoot, "src", "components", "portal");
const appDir = join(repoRoot, "src", "app");

/**
 * Every portal component that renders a zero-data state, and the registry ids it renders.
 *
 * This list is the guard. A heuristic scan for empty-state markup cannot work: the markup has no
 * reliable signature, and this change itself removed the literal `status="empty"` from most
 * surfaces by routing them through `spec.status`. So instead of guessing which files have empty
 * states, the test below asserts that *every* portal component is either listed here or listed
 * in `componentsWithoutEmptyStates` with a reason. Adding a component forces that decision, and
 * adding an empty state to a listed component fails the id assertions unless it is registered.
 */
const componentEmptyStates: Readonly<Record<string, readonly string[]>> = {
  "approval-gate-panel.tsx": ["approval-none"],
  "dashboard-view.tsx": [
    "loop-registry-no-loops",
    "timeline-no-events",
    "artifacts-none",
    // The first-screen activation step (#128). It names whichever onboarding stage is active;
    // `onboarding-no-loops` is the one it references directly, as the resolver's fallback.
    "onboarding-no-loops",
  ],
  "deployment-summary.tsx": ["deployments-none"],
  "fixture-unavailable.tsx": ["fixture-only-surface"],
  "github-settings-view.tsx": ["github-settings-no-installation", "github-settings-none"],
  "loop-registration-view.tsx": ["loop-registration-no-repositories"],
  "registered-loop-registry.tsx": ["onboarding-no-loops"],
  "repo-catalog.tsx": ["onboarding-no-repositories", "catalog-no-filter-matches"],
  "repository-selection-view.tsx": [
    "repository-selection-not-connected",
    "repository-selection-no-access",
  ],
  "reusable-states.tsx": ["onboarding-no-loops"],
  "run-records-view.tsx": ["runs-none", "run-steps-none", "run-approvals-none"],
  "validation-gate-summary.tsx": ["validation-gates-none"],
  "validation-result-summary.tsx": ["validation-results-none"],
};

/** Why each remaining portal component has no empty state of its own. */
const componentsWithoutEmptyStates: Readonly<Record<string, string>> = {
  "artifact-list-item.tsx": "renders one artifact row; its list owns the empty state",
  "fixture-gated-page.tsx": "delegates entirely to FixtureUnavailableNotice",
  "loop-card.tsx": "renders one loop row; its registry owns the empty state",
  "loop-registration-refresher.tsx": "refresh plumbing; renders no surface of its own",
  "portal-shell.tsx": "navigation chrome; never renders records",
  "registered-loop-card.tsx": "renders one loop row; its registry owns the empty state",
  "repository-selection-refresher.tsx": "refresh plumbing; renders no surface of its own",
  "run-timeline-item.tsx": "renders one timeline event; its list owns the empty state",
};

/**
 * States reachable only by composing a source or onboarding state, rather than by a component
 * naming them directly. `resolvePortalEmptyState` selects these, so they have no owning file.
 */
const composedEmptyStateIds: readonly string[] = [
  "portal-unavailable",
  "onboarding-no-installation",
];

function portalComponentFiles(): string[] {
  return readdirSync(portalComponentDir)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".stories.tsx"))
    .sort();
}

/** Every routable path the App Router actually serves, derived from the filesystem. */
function appRoutePaths(): Set<string> {
  const paths = new Set<string>();

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (entry !== "page.tsx" && entry !== "route.ts") {
        continue;
      }

      const segments = relative(appDir, dir)
        .split("/")
        .filter((segment) => segment.length > 0 && !segment.startsWith("("));

      paths.add(`/${segments.join("/")}`);
    }
  };

  walk(appDir);
  return paths;
}

const specs = Object.values(PORTAL_EMPTY_STATES) as PortalEmptyStateSpec[];
const registeredIds = new Set(Object.keys(PORTAL_EMPTY_STATES));

describe("portal empty-state inventory", () => {
  it("forces every portal component to declare whether it has an empty state", () => {
    const undeclared = portalComponentFiles().filter(
      (name) =>
        componentEmptyStates[name] === undefined &&
        componentsWithoutEmptyStates[name] === undefined,
    );

    expect(
      undeclared,
      "these portal components are in neither inventory list; add their empty states to componentEmptyStates, or record why they have none",
    ).toEqual([]);
  });

  it("declares no component in both inventory lists", () => {
    const both = Object.keys(componentEmptyStates).filter(
      (name) => componentsWithoutEmptyStates[name] !== undefined,
    );

    expect(both).toEqual([]);
  });

  it("inventories only components that exist", () => {
    const files = new Set(portalComponentFiles());
    const missing = [
      ...Object.keys(componentEmptyStates),
      ...Object.keys(componentsWithoutEmptyStates),
    ].filter((name) => !files.has(name));

    expect(missing, "these inventory entries name components that no longer exist").toEqual([]);
  });

  it("registers every empty state a portal component claims to render", () => {
    for (const [file, ids] of Object.entries(componentEmptyStates)) {
      for (const id of ids) {
        expect(registeredIds.has(id), `${file} renders unregistered empty state ${id}`).toBe(true);
      }
    }
  });

  it("renders every registered empty state somewhere", () => {
    const rendered = new Set([
      ...Object.values(componentEmptyStates).flat(),
      ...composedEmptyStateIds,
    ]);
    const orphaned = [...registeredIds].filter((id) => !rendered.has(id));

    expect(
      orphaned,
      "these registry entries are never rendered, so their copy and routing are unverifiable fiction",
    ).toEqual([]);
  });

  it("wires every component's declared empty states into its source", () => {
    for (const [file, ids] of Object.entries(componentEmptyStates)) {
      const source = readFileSync(join(portalComponentDir, file), "utf8");

      for (const id of ids) {
        // Either named directly, or reached through the resolver's fallback argument.
        expect(source.includes(`"${id}"`), `${file} does not reference ${id}`).toBe(true);
      }
    }
  });

  it("gives every empty state an action or an explicit terminal reason", () => {
    for (const spec of specs) {
      const handled = spec.action !== undefined || spec.terminal !== undefined;

      expect(handled, `${spec.id} declares neither an action nor a terminal reason`).toBe(true);
    }
  });

  it("states why every terminal empty state has no next step", () => {
    for (const spec of specs) {
      if (spec.terminal === undefined) {
        continue;
      }

      expect(
        spec.terminal.trim().length,
        `${spec.id} has an empty terminal reason`,
      ).toBeGreaterThan(0);
      expect(spec.action, `${spec.id} is terminal but also carries an action`).toBeUndefined();
      expect(
        spec.secondaryAction,
        `${spec.id} is terminal but carries a secondary action`,
      ).toBeUndefined();
    }
  });

  it("gives every action a label", () => {
    for (const spec of specs) {
      for (const action of [spec.action, spec.secondaryAction]) {
        if (action === undefined) {
          continue;
        }

        expect(action.label.trim().length, `${spec.id} has an unlabeled action`).toBeGreaterThan(0);
      }
    }
  });

  it("routes every internal link action to a path the app actually serves", () => {
    const routes = appRoutePaths();

    for (const spec of specs) {
      for (const action of [spec.action, spec.secondaryAction]) {
        if (action?.kind !== "link" || action.external === true) {
          continue;
        }

        expect(
          routes.has(action.href),
          `${spec.id} routes to ${action.href}, which the app router does not serve`,
        ).toBe(true);
      }
    }
  });

  it("offers the reconciliation route wherever it offers installation", () => {
    // GitHub dead-ends the install link for an account that already has the App (#151), so an
    // install action alone is exactly the dead end this issue exists to remove.
    for (const spec of specs) {
      if (spec.action?.kind !== "link" || spec.action.href !== "/api/github/install") {
        continue;
      }

      expect(
        spec.secondaryAction?.kind === "link" &&
          spec.secondaryAction.href === "/api/github/install/reconcile",
        `${spec.id} offers installation without the reconciliation route beside it`,
      ).toBe(true);
    }
  });

  it("keys every spec by its own id", () => {
    for (const [key, spec] of Object.entries(PORTAL_EMPTY_STATES)) {
      expect(spec.id).toBe(key);
    }
  });

  it("declares copy for every empty state", () => {
    for (const spec of specs) {
      expect(spec.title.trim().length, `${spec.id} has no title`).toBeGreaterThan(0);
      expect(spec.detail.trim().length, `${spec.id} has no detail`).toBeGreaterThan(0);
    }
  });
});
