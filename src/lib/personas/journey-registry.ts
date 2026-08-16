import {
  type PersonaJourneyRegistry,
  personaJourneyRegistrySchema,
} from "../../../schemas/persona-journey";

/**
 * The executable projection of `docs/personas-and-test-scenarios.md`.
 *
 * Parsed at module load, mirroring how `defaultLoopManifest` is parsed in
 * `src/lib/loops/manifest.ts`: an invalid entry fails at import rather than at
 * the first reader.
 *
 * `fixtureWorldId` and `sessionProfileId` are opaque forward references. #242
 * resolves fixture worlds and #201 resolves session profiles; nothing here
 * requires them to resolve yet, and declaring them is what lets those issues
 * build against a fixed target.
 *
 * `budgets.maxActions` is the declared action count plus a small headroom, so
 * the schema's budget refinement can actually bite. `maxDurationMs` is the
 * journey's own budget; Playwright's default per-test timeout is 30s, so #243
 * must raise `timeout` in the browser config for the longer walks to run at
 * all rather than being killed before their budget is reached.
 *
 * Every route, heading, and control named below is verified against the running
 * product by `tests/unit/personas/journey-registry.test.ts`, which fails when a
 * declared route has no file under `src/app` or a quoted heading appears
 * nowhere in the source. The claim is enforced, not asserted in prose.
 *
 * ## Deliberately absent scenarios
 *
 * A02, A03, R02, S05, and M02 are browser-applicable in the persona matrix but
 * describe product behaviour that does not exist yet:
 *
 * - A02 — `/approvals` renders exactly one gate (`mapApproval` in
 *   `src/lib/portal/records.ts` returns the highest-priority row or null), with
 *   no actor attribution. The five states live on the run-detail surface.
 * - A03 — `TimelineEvent.artifact` is a single string (`src/lib/types.ts`), so
 *   the Test-writing stage's two contracted artifacts collapse to one in the
 *   DOM, and "LLM review" is never a rendered label. Evidence vocabulary does
 *   exist ("Automated test plan", `test_plan`, "Red test evidence"); what is
 *   missing is a rendered ordering the browser can assert.
 * - R02 — no per-surface coverage or changed-surface field exists on any run
 *   record, so "coverage for the changed surface" has nothing to read. Design
 *   tokens are separately browser-verifiable already (`tests/e2e/portal.spec.ts`
 *   compares computed styles to CSS custom properties), so that half is covered
 *   and only the changed-surface half is blocked.
 * - S05 — needs two identities in one journey, and the approval confirm button
 *   closes its dialog without writing; nothing in `src/` calls the approval
 *   transition route.
 * - M02 — the routing toggle is React state only, so nothing persists and the
 *   skipped reason the UI shows is locally recomputed rather than the trigger
 *   path's own decision.
 *
 * Declaring journeys for them would hand #243 checkpoints no DOM can satisfy
 * and #242 fixture worlds for surfaces that do not exist. They move to their
 * own issue, to land once their product surfaces do.
 */
export const personaJourneyRegistry: PersonaJourneyRegistry = personaJourneyRegistrySchema.parse({
  version: 1,
  journeys: [
    {
      journeyId: "operator-route-walk",
      personaTestIds: ["P01"],
      goal: "A signed-in operator reaches every protected portal slice through the shell and finds a consistent session surface on each.",
      startState:
        "One tracked repository, both loops enabled, and at least one completed run exist, so no slice renders an empty state.",
      endState:
        "Every nav destination has rendered at its own route with the shared shell intact and no browser runtime error.",
      surfaces: [
        "app-shell",
        "dashboard",
        "catalog",
        "loops",
        "runs",
        "approvals",
        "deployments",
        "settings",
      ],
      allowedRoutes: [
        "/",
        "/catalog",
        "/loops",
        "/runs",
        "/approvals",
        "/deployments",
        "/settings",
      ],
      fixtureWorldId: "operator-active-portal",
      session: { kind: "persona_fixture", sessionProfileId: "operator-primary" },
      actions: [
        { id: "open-dashboard", description: "Open the dashboard.", surface: "dashboard" },
        {
          id: "use-primary-nav",
          description: "Move between slices through the shell's primary navigation.",
          surface: "app-shell",
        },
        { id: "open-catalog", description: "Follow the Catalog nav link.", surface: "catalog" },
        { id: "open-loops", description: "Follow the Loops nav link.", surface: "loops" },
        { id: "open-runs", description: "Follow the Runs nav link.", surface: "runs" },
        {
          id: "open-approvals",
          description: "Follow the Approvals nav link.",
          surface: "approvals",
        },
        {
          id: "open-deployments",
          description: "Follow the Deployments nav link.",
          surface: "deployments",
        },
        { id: "open-settings", description: "Follow the Settings nav link.", surface: "settings" },
      ],
      checkpoints: [
        {
          id: "dashboard-heading",
          description:
            "The dashboard renders 'Agentic delivery loops, repo health, and deployment visibility'.",
        },
        {
          // The dashboard itself renders the 'Repo catalog', 'Approval gate',
          // and 'Vercel deployments and previews' panel headings, so asserting
          // a heading alone would pass without ever leaving `/`. The URL is
          // what discriminates.
          id: "each-slice-reached-at-its-own-route",
          description:
            "Each nav destination settles at its declared route before its heading is asserted.",
        },
        {
          id: "shared-session-surface",
          description: "The shell keeps the same session surface on every slice.",
        },
      ],
      expectations: {
        functional: [
          "Every nav destination resolves to its declared route.",
          "No slice emits a browser runtime error.",
        ],
        keyboard: ["Primary navigation is reachable in document order with a visible focus ring."],
        accessibility: ["axe reports no violations, including contrast, on every slice."],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 120_000, maxActions: 10 },
    },
    {
      journeyId: "theme-persistence",
      personaTestIds: ["P04"],
      goal: "An operator switches between light and dark from the app shell and the choice survives a reload.",
      startState: "The operator is signed in with no stored theme preference.",
      endState: "The chosen theme is still applied after a reload and both themes meet contrast.",
      surfaces: ["app-shell", "dashboard"],
      allowedRoutes: ["/"],
      // Its own world: the precondition is browser-storage state ("no stored
      // theme preference"), not the database state `operator-active-portal`
      // describes. Sharing would let a leaked theme decide what the route
      // walk's contrast assertions measure.
      fixtureWorldId: "operator-theme-default",
      session: { kind: "persona_fixture", sessionProfileId: "operator-primary" },
      actions: [
        { id: "open-dashboard", description: "Open the dashboard.", surface: "dashboard" },
        {
          id: "toggle-theme",
          description: "Switch the theme from the shell's 'Toggle theme' control.",
          surface: "app-shell",
        },
        { id: "reload", description: "Reload the page.", surface: "app-shell" },
      ],
      checkpoints: [
        { id: "theme-applied", description: "The shell reflects the newly chosen theme." },
        { id: "theme-persists", description: "The choice is still applied after the reload." },
      ],
      expectations: {
        functional: ["The applied theme is observable from the document before and after reload."],
        // `src/components/mode-toggle.tsx` renders `aria-label="Toggle theme"`
        // and is `disabled` until hydration; it exposes no pressed or checked
        // state. The expectation describes that control, not a better one.
        keyboard: [
          "The theme control is keyboard-reachable once hydrated and exposes an accessible name.",
        ],
        accessibility: ["Both themes meet contrast requirements under axe."],
      },
      viewports: ["desktop"],
      themes: ["light", "dark"],
      mutations: ["browser_storage_write"],
      budgets: { maxDurationMs: 60_000, maxActions: 5 },
    },
    {
      journeyId: "day-zero-activation",
      personaTestIds: ["P05", "M04", "M05"],
      goal: "A day-zero operator with no installation, repositories, or loops walks to a registered loop without ever meeting an empty state they cannot act on.",
      startState:
        "An empty database: no installation, no tracked repository, no registered loop, no run.",
      endState:
        "One installation is connected, one repository is tracked, and one loop is registered and reflected in the registry with its enabled state, triggers, gates, and approvals.",
      surfaces: [
        "app-shell",
        "dashboard",
        "catalog",
        "loops",
        "loop-registration",
        "settings",
        "settings-repositories",
      ],
      allowedRoutes: [
        "/",
        "/catalog",
        "/loops",
        "/loops/register",
        "/settings",
        "/settings/repositories",
        "/settings?github=cancelled",
        "/settings?github=no-installation-found",
      ],
      fixtureWorldId: "day-zero-empty",
      session: { kind: "persona_fixture", sessionProfileId: "operator-primary" },
      actions: [
        {
          id: "land-without-installation",
          description: "Open the dashboard with no installation connected.",
          surface: "dashboard",
        },
        {
          id: "check-catalog-empty-state",
          description: "Open the catalog while no repository is tracked.",
          surface: "catalog",
        },
        {
          id: "check-loops-empty-state",
          description: "Open the loop registry while no loop is registered.",
          surface: "loops",
        },
        {
          id: "read-cancelled-install",
          description: "Return from a cancelled GitHub install.",
          surface: "settings",
        },
        {
          id: "read-no-installation-found",
          description: "Return from an install GitHub reports nothing for.",
          surface: "settings",
        },
        {
          // The repository list itself comes from GitHub, which the browser
          // lane stubs at the boundary, so the operator-visible step is that
          // the surface is reachable and is not a dead end.
          id: "open-repository-selection",
          description: "Open repository selection once an installation exists.",
          surface: "settings-repositories",
        },
        {
          id: "register-loop",
          description: "Register the first loop against the tracked repository.",
          surface: "loop-registration",
        },
      ],
      checkpoints: [
        {
          id: "names-installation-step",
          description: "The first screen after sign-in names the installation step.",
        },
        {
          id: "install-links-point-at-app-routes",
          description:
            "The install affordance targets '/api/github/install' and the reconciliation link targets '/api/github/install/reconcile'; neither is followed.",
        },
        {
          id: "cancelled-and-not-found-differ",
          description:
            "A cancelled install and an install GitHub reports nothing for read differently, and both offer the reconciliation route.",
        },
        {
          id: "repository-selection-reachable",
          description:
            "'Repository selection' renders and is not an empty state the operator cannot act on.",
        },
        {
          // M05's matrix row requires all four facts, not just enabled state.
          id: "registry-reflects-loop",
          description:
            "'Registered loops' reflects the new loop's enabled state, 'Trigger labels', 'Validation gates', and 'Approval requirements'.",
        },
        {
          id: "no-dead-end-empty-state",
          description: "No empty state names an action the operator cannot take.",
        },
      ],
      expectations: {
        functional: [
          "Each step is the precondition of the next; the walk ends at a registered loop.",
          "Producing a first run is outside this walk.",
        ],
        keyboard: [
          "Every activation step is reachable and operable by keyboard.",
          "Repository selection and loop registration stay keyboard-operable at mobile width.",
        ],
        accessibility: ["axe passes at every step in both themes."],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["fixture_database_write"],
      budgets: { maxDurationMs: 300_000, maxActions: 9 },
    },
    {
      journeyId: "catalog-metadata-and-filters",
      personaTestIds: ["M01"],
      goal: "A maintainer reads repository metadata from the catalog and narrows it with search and filter controls.",
      startState:
        "Several tracked repositories exist with owner, framework, CI commands, docs, observability, design-system, and Vercel project metadata.",
      endState: "The catalog has been narrowed to a chosen repository through the controls.",
      surfaces: ["app-shell", "catalog"],
      allowedRoutes: ["/catalog"],
      fixtureWorldId: "maintainer-catalog",
      session: { kind: "persona_fixture", sessionProfileId: "maintainer-primary" },
      actions: [
        { id: "open-catalog", description: "Open the repo catalog.", surface: "catalog" },
        {
          id: "narrow-with-controls",
          description: "Use 'Search repositories' and the health filter to narrow the rows.",
          surface: "catalog",
        },
      ],
      checkpoints: [
        { id: "catalog-heading", description: "The catalog renders the 'Repo catalog' heading." },
        {
          id: "row-metadata-present",
          description:
            "A row shows its owner, framework, CI commands, 'Docs', 'Observability', 'Design system', enabled loops, and Vercel project links.",
        },
        {
          id: "controls-narrow-rows",
          description: "'Search repositories' and the health filter change the visible rows.",
        },
      ],
      expectations: {
        functional: ["Every declared metadata field is present on a catalog row."],
        keyboard: ["Search and filter controls are reachable and operable by keyboard."],
        accessibility: ["axe reports no violations on the catalog surface."],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 90_000, maxActions: 4 },
    },
    {
      journeyId: "run-detail-stage-sequence",
      personaTestIds: ["A01"],
      goal: "An agent supervisor opens a research run and reads its exact stage sequence with the artifacts each stage produced.",
      startState:
        "A completed research run exists in the journey's fixture world with planning, researching, authoring, and done stages and their four artifact contracts.",
      endState: "The supervisor has seen every stage in order with its artifact links.",
      surfaces: ["app-shell", "runs"],
      // The run is selected through the run list rather than a deep link: run
      // ids belong to the fixture world (#242), and `preferredInitialRun`
      // silently falls back to the first succeeded run for an unknown id, so a
      // pinned id would fail on the wrong run with a misleading message.
      allowedRoutes: ["/runs"],
      fixtureWorldId: "supervisor-research-run",
      session: { kind: "persona_fixture", sessionProfileId: "supervisor-primary" },
      actions: [
        {
          id: "open-research-run",
          description: "Select the research run from the run list.",
          surface: "runs",
        },
        { id: "read-stage-sequence", description: "Read the ordered stage list.", surface: "runs" },
      ],
      checkpoints: [
        { id: "run-detail-heading", description: "The surface renders the 'Run detail' heading." },
        {
          id: "stages-in-order",
          description:
            "'Planning', 'Researching', 'Authoring', and 'Done' appear in that vertical order.",
        },
        {
          id: "artifact-links-present",
          description:
            "'Research plan', 'Findings artifacts', 'Research document', and 'Completion summary' are linked.",
        },
      ],
      expectations: {
        functional: ["Stage order is asserted by position, not merely by presence."],
        keyboard: ["Every artifact link is reachable by keyboard with an accessible name."],
        accessibility: ["axe reports no violations on run detail in either theme."],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 90_000, maxActions: 4 },
    },
    {
      journeyId: "pr-intent-linkage",
      personaTestIds: ["R01"],
      goal: "A reviewer opens a run carrying a PR intent and reaches its validation artifacts and Vercel preview with commit and branch metadata.",
      startState:
        "A run exists with a PR intent, validation artifacts, and a preview deployment in the journey's fixture world.",
      endState: "The artifact and preview destinations have been reached from the run.",
      surfaces: ["app-shell", "runs", "deployments"],
      allowedRoutes: ["/runs", "/deployments"],
      fixtureWorldId: "reviewer-pr-intent",
      session: { kind: "persona_fixture", sessionProfileId: "reviewer-primary" },
      actions: [
        {
          id: "open-run-with-intent",
          description: "Open the run carrying a PR intent.",
          surface: "runs",
        },
        {
          // Artifact and preview targets are github.com / vercel.app, which no
          // test may reach, and they open in a new tab. The hrefs are read,
          // never followed — as the existing specs do.
          id: "read-artifact-links",
          description: "Read the artifact and preview link targets.",
          surface: "runs",
        },
        {
          id: "read-deployment-metadata",
          description: "Read the deployment's commit and branch metadata.",
          surface: "deployments",
        },
      ],
      checkpoints: [
        // R01's matrix row also asks for a link to the source issue. `issueHref`
        // exists on the run record but no component renders it as a link — the
        // issue is plain text. That half of R01 moves to the follow-up issue
        // rather than becoming a checkpoint #243 cannot satisfy.
        {
          id: "artifacts-linked",
          description: "Validation artifacts are reachable as links from 'Run detail'.",
        },
        {
          id: "preview-linked",
          description:
            "'Vercel deployments and previews' shows the deployment with its commit and branch metadata.",
        },
        {
          id: "run-names-its-issue",
          description: "The run states its source issue, even though it is not yet a link.",
        },
      ],
      expectations: {
        functional: [
          "Each artifact with an allowlisted target renders a link; a non-allowlisted target renders an 'Invalid Link' badge and no href.",
        ],
        keyboard: ["Every link is reachable by keyboard with an accessible name."],
        accessibility: ["axe reports no violations on the run and deployment surfaces."],
      },
      viewports: ["desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 90_000, maxActions: 5 },
    },
    {
      journeyId: "unauthenticated-orientation",
      personaTestIds: ["P06"],
      goal: "An unauthenticated visitor turned away from a protected route learns what Loopworks is, why GitHub holds the identity, and that access is approved rather than self-served — before authenticating.",
      startState: "No session. The visitor requests a protected route directly.",
      endState:
        "The visitor has read the orientation copy and reached the single primary sign-in action.",
      // `loops` is declared because the journey starts there: without it, a
      // change to that route or the guard would not expand to this journey in
      // #244, which is the one thing it exists to protect.
      surfaces: ["loops", "sign-in"],
      // No `callbackUrl` variant is declared: the proxy sets it to
      // `request.nextUrl.href`, an absolute URL whose host and port vary by
      // environment, so no literal is correct. A checkpoint asserts the
      // pathname instead, as `tests/e2e/auth-guard.spec.ts` already does.
      allowedRoutes: ["/loops", "/sign-in"],
      fixtureWorldId: "unauthenticated-visitor",
      session: { kind: "unauthenticated" },
      actions: [
        {
          id: "request-protected-route",
          description: "Request a protected route with no session.",
          surface: "loops",
        },
        { id: "read-orientation", description: "Read the orientation copy.", surface: "sign-in" },
      ],
      checkpoints: [
        {
          id: "redirected-to-sign-in",
          description:
            "The request settles on the sign-in pathname and the protected route's own heading never renders.",
        },
        {
          id: "explains-github-identity",
          description: "'Why Loopworks uses GitHub' and 'Who can sign in' are present.",
        },
        {
          id: "single-primary-action",
          description: "'Continue with GitHub' is the single primary action.",
        },
      ],
      expectations: {
        functional: [
          "No signup or request-access affordance is offered.",
          "Activation steps are described before authenticating.",
        ],
        keyboard: ["The primary action is reachable by keyboard with a visible focus ring."],
        accessibility: ["axe reports no violations in either theme."],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 60_000, maxActions: 4 },
    },
    {
      journeyId: "denied-sign-in-copy",
      personaTestIds: ["S07"],
      goal: "A denied or failed sign-in renders mapped copy with an honest next step and never exposes raw error parameters, provider errors, tokens, scopes, or allowlist internals.",
      startState: "No session. The sign-in surface is reached carrying a failure parameter.",
      endState:
        "The failure has been rendered as an outcome with a human next step and nothing sensitive disclosed.",
      surfaces: ["sign-in"],
      allowedRoutes: [
        "/sign-in",
        "/sign-in?error=AccessDenied",
        "/sign-in?error=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E",
      ],
      fixtureWorldId: "unauthenticated-denied",
      session: { kind: "unauthenticated" },
      actions: [
        {
          id: "arrive-denied",
          description: "Reach the sign-in surface with a denial parameter.",
          surface: "sign-in",
        },
        {
          id: "arrive-hostile-parameter",
          description: "Reach it with a hostile error parameter.",
          surface: "sign-in",
        },
      ],
      checkpoints: [
        {
          id: "mapped-copy",
          description:
            "A denied sign-in renders 'This GitHub account is not approved yet' with a next step, not a raw code.",
        },
        {
          id: "no-raw-parameter",
          description: "The raw error parameter is never shown, however it arrives.",
        },
        {
          id: "no-internals",
          description: "No allowlist internals, tokens, scopes, or provider errors are disclosed.",
        },
        {
          id: "stable-height",
          description: "The surface height holds steady between the default and failure states.",
        },
      ],
      expectations: {
        functional: ["The primary action stays enabled so the visitor can retry."],
        keyboard: ["The primary action remains keyboard-reachable in the failure state."],
        accessibility: [
          "axe reports no violations in the default or denied state, in both themes.",
        ],
      },
      viewports: ["mobile", "desktop"],
      themes: ["light", "dark"],
      mutations: ["none"],
      budgets: { maxDurationMs: 60_000, maxActions: 4 },
    },
  ],
});
