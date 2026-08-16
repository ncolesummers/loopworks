import { z } from "zod";

import { personaTestIdValues } from "./loop-manifest";

/**
 * Stable contract identifier. The registry is versioned in two places that must
 * agree: this identifier, which names the contract, and the `version` literal,
 * which a document carries. `personaJourneyRegistryVersion` feeds both so a
 * bump cannot update one and miss the other.
 */
export const personaJourneyRegistryVersion = 1;
export const personaJourneyRegistryId =
  `loopworks.persona_journey.v${personaJourneyRegistryVersion}` as const;

/**
 * The five personas in `docs/personas-and-test-scenarios.md`. Distinct from the
 * scenario IDs: `personaTestIdValues` holds *scenario* identifiers (P01, M01,
 * …), not persona identities. The role vocabulary exists so #244 has a persona
 * dimension; it is derived from scenario IDs, never stored beside them.
 */
export const personaRoleValues = [
  "product_operator",
  "maintainer",
  "agent_supervisor",
  "reviewer",
  "security_reviewer",
] as const;

/**
 * Scenario-ID prefix to persona role. The mapping is total over
 * `personaTestIdValues` and surjective onto `personaRoleValues`, both asserted
 * by test.
 *
 * The registry stores no persona field: the role is a pure function of the
 * scenario IDs, so storing it could only create a second place for the same
 * fact to be wrong. #244 selects on personas by calling the derivation.
 */
export const personaRoleByScenarioPrefix = {
  P: "product_operator",
  M: "maintainer",
  A: "agent_supervisor",
  R: "reviewer",
  S: "security_reviewer",
} as const satisfies Record<string, (typeof personaRoleValues)[number]>;

export function personaRolesForScenarioIds(
  scenarioIds: readonly (typeof personaTestIdValues)[number][],
): (typeof personaRoleValues)[number][] {
  const roles = new Set<(typeof personaRoleValues)[number]>();
  for (const scenarioId of scenarioIds) {
    const prefix = scenarioId[0] as keyof typeof personaRoleByScenarioPrefix;
    const role = personaRoleByScenarioPrefix[prefix];
    // Throws rather than skipping: a silently dropped role would make the
    // derived persona set quietly incomplete for a caller in a later layer.
    if (!role) throw new Error(`No persona role for scenario id \`${scenarioId}\`.`);
    roles.add(role);
  }
  return [...roles];
}

/**
 * Product surfaces a journey may touch. Grounded in the App Router tree under
 * `src/app`, plus `app-shell` for the chrome every authenticated route shares.
 * A changed surface expands to its dependent journeys in #244; that selection
 * is only possible because this vocabulary is closed.
 */
export const journeySurfaceValues = [
  "app-shell",
  "dashboard",
  "catalog",
  "loops",
  "loop-registration",
  "runs",
  "approvals",
  "deployments",
  "settings",
  "settings-repositories",
  "github-install-landing",
  "sign-in",
] as const;

export const journeyViewportValues = ["mobile", "tablet", "desktop"] as const;

export const journeyThemeValues = ["light", "dark"] as const;

/**
 * What a journey is permitted to change. There is deliberately no value for a
 * GitHub, Vercel, or other external write: a journey that needs one is not
 * deterministic, and the omission makes that unrepresentable rather than
 * merely discouraged.
 */
export const journeyMutationValues = [
  "none",
  "fixture_database_write",
  "browser_storage_write",
] as const;

/**
 * Cleanup obligations, derived from `mutations` rather than declared.
 *
 * An earlier revision carried a `resetExpectation` field pinned to `mutations`
 * by a refinement. With only `no_persistent_state` and `fixture_world_reset`
 * available, a storage-only journey such as P04 was forced to instruct #242 to
 * reset a fixture world it never wrote to. Deriving keeps the two cleanup
 * obligations distinct and removes a field whose only possible values were
 * "the derived one" and "a CI failure".
 */
export const journeyCleanupValues = ["fixture_database_reset", "browser_storage_reset"] as const;

const cleanupByMutation = {
  none: undefined,
  fixture_database_write: "fixture_database_reset",
  browser_storage_write: "browser_storage_reset",
} as const satisfies Record<string, (typeof journeyCleanupValues)[number] | undefined>;

export function journeyCleanupForMutations(
  mutations: readonly (typeof journeyMutationValues)[number][],
): (typeof journeyCleanupValues)[number][] {
  const cleanups = new Set<(typeof journeyCleanupValues)[number]>();
  for (const mutation of mutations) {
    const cleanup = cleanupByMutation[mutation];
    if (cleanup) cleanups.add(cleanup);
  }
  return [...cleanups];
}

export const scenarioCoverageKindValues = [
  "browser_journey",
  "deterministic_non_browser",
  "not_applicable",
  "deferred",
] as const;

const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Expected a lowercase kebab-case id.");

/**
 * Non-blank rather than merely non-empty. `min(1)` alone accepts `" "`, which
 * would let a `not_applicable` rationale be a single space while still reading
 * as a written justification. Expressed as a regex so the constraint survives
 * into the generated JSON mirror.
 */
const nonBlankText = z.string().min(1).regex(/\S/, "Expected non-blank text.");

/**
 * `%` is deliberately absent from the path segment class. A literal-dot
 * traversal guard is worthless if the author can spell the dots as `%2e`:
 * `new URL("/%2e%2e/admin", base)` resolves to `/admin`, so the declared route
 * and the navigated route would be different paths. No product route needs
 * percent-encoding in its path; the query keeps it, because a journey must be
 * able to declare an encoded query value it navigates to.
 */
const routeSegmentPattern = "[A-Za-z0-9\\-._~!$&'()*+,;=:@\\[\\]]+";
const routeQueryPattern = "[A-Za-z0-9\\-._~%!$&'()*+,;=:@\\[\\]/?]*";
// Rejects a `.` or `..` segment wherever it appears.
const routeNotDotSegment = "(?!\\.\\.?(?:[/?#]|$))";

/**
 * A site-relative route: mandatory leading slash, optional dot-free segments,
 * optional trailing slash, optional query and fragment.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//host` and bare `//`), and
 * traversal in both literal and percent-encoded spellings. The trailing slash
 * sits inside the segment group so a bare `//`, which `new URL` cannot parse,
 * is not reachable.
 *
 * The traversal guard is inside the pattern rather than in a `.refine()`
 * because `z.toJSONSchema` silently drops refinements: a refined guard would
 * be present in Zod and absent from the mirror, and the two artifacts would
 * disagree about which routes are legal.
 *
 * The lookahead is ECMA-262. An RE2-based validator (Go, some CEL toolchains)
 * cannot compile it. No consumer reads the mirror today; revisit if one does.
 */
export const relativeRoutePattern = new RegExp(
  `^/(?:${routeNotDotSegment}${routeSegmentPattern}(?:/${routeNotDotSegment}${routeSegmentPattern})*/?)?(?:\\?${routeQueryPattern})?(?:#${routeQueryPattern})?$`,
);

const relativeRouteSchema = z
  .string()
  .regex(relativeRoutePattern, "Expected a site-relative route without traversal.");

const personaTestIdSchema = z.enum(personaTestIdValues);

const journeyActionSchema = z
  .object({
    id: slugSchema,
    description: nonBlankText,
    surface: z.enum(journeySurfaceValues),
  })
  .strict();

const journeyCheckpointSchema = z
  .object({
    id: slugSchema,
    description: nonBlankText,
  })
  .strict();

const journeyExpectationsSchema = z
  .object({
    functional: uniqueArray(nonBlankText, "expectation"),
    keyboard: uniqueArray(nonBlankText, "expectation"),
    accessibility: uniqueArray(nonBlankText, "expectation"),
  })
  .strict();

/**
 * Bounded rather than free text so #243 can fail a journey that exceeds its
 * budget instead of letting it slow the lane silently.
 */
const journeyBudgetsSchema = z
  .object({
    maxDurationMs: z.number().int().min(1_000).max(600_000),
    maxActions: z.number().int().min(1).max(200),
  })
  .strict();

/**
 * Authenticated journeys reference an opaque session-profile id; #201 owns what
 * that id resolves to. Unauthenticated journeys (P06, S07) declare the absence
 * of a session explicitly rather than through a sentinel profile.
 */
const journeySessionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unauthenticated") }).strict(),
  z
    .object({
      kind: z.literal("persona_fixture"),
      sessionProfileId: slugSchema,
    })
    .strict(),
]);

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Uniqueness that survives generation. `uniqueItems` is a core JSON Schema
 * keyword and Zod emits it from `.meta()`, but `.meta()` alone does not
 * validate — so the refinement enforces and the metadata mirrors, and the two
 * artifacts agree instead of the mirror being needlessly weaker.
 */
function uniqueArray<T extends z.ZodType>(items: T, label: string) {
  return z
    .array(items)
    .min(1)
    .refine((values) => !hasDuplicates(values as readonly string[]), `Duplicate ${label}.`)
    .meta({ uniqueItems: true });
}

const personaJourneyShape = z
  .object({
    journeyId: slugSchema,
    // Scenario identifiers from the persona matrix. Named `personaTestIds` to
    // match the vocabulary `schemas/loop-manifest.ts` already established.
    // Persona roles are derived from these, never stored alongside them.
    personaTestIds: uniqueArray(personaTestIdSchema, "scenario id"),
    goal: nonBlankText,
    startState: nonBlankText,
    endState: nonBlankText,
    surfaces: uniqueArray(z.enum(journeySurfaceValues), "surface"),
    allowedRoutes: uniqueArray(relativeRouteSchema, "route"),
    // Opaque forward references. #242 resolves the fixture world and #201 the
    // session profile; declaring them now is what lets those siblings build
    // against a fixed target.
    fixtureWorldId: slugSchema,
    session: journeySessionSchema,
    actions: z.array(journeyActionSchema).min(1),
    checkpoints: z.array(journeyCheckpointSchema).min(1),
    expectations: journeyExpectationsSchema,
    viewports: uniqueArray(z.enum(journeyViewportValues), "viewport"),
    themes: uniqueArray(z.enum(journeyThemeValues), "theme"),
    mutations: uniqueArray(z.enum(journeyMutationValues), "mutation"),
    budgets: journeyBudgetsSchema,
  })
  .strict();

/**
 * Cross-field invariants. JSON Schema cannot express these, so they live in Zod
 * alone and the generated mirror is a structural subset of this schema: a
 * document the mirror accepts may still be rejected here. The mirror's
 * `$comment` says so for a reader who only has the JSON.
 *
 * Single-field constraints are kept as regexes and bounds precisely so they do
 * survive generation; anything spanning two fields necessarily does not.
 */
export const personaJourneySchema = personaJourneyShape.superRefine((journey, context) => {
  if (hasDuplicates(journey.personaTestIds)) {
    context.addIssue({
      code: "custom",
      path: ["personaTestIds"],
      message: "Duplicate scenario id.",
    });
  }
  if (hasDuplicates(journey.viewports)) {
    context.addIssue({ code: "custom", path: ["viewports"], message: "Duplicate viewport." });
  }
  if (hasDuplicates(journey.themes)) {
    context.addIssue({ code: "custom", path: ["themes"], message: "Duplicate theme." });
  }
  if (hasDuplicates(journey.surfaces)) {
    context.addIssue({ code: "custom", path: ["surfaces"], message: "Duplicate surface." });
  }
  if (hasDuplicates(journey.actions.map((action) => action.id))) {
    context.addIssue({ code: "custom", path: ["actions"], message: "Duplicate action id." });
  }
  if (hasDuplicates(journey.checkpoints.map((checkpoint) => checkpoint.id))) {
    context.addIssue({
      code: "custom",
      path: ["checkpoints"],
      message: "Duplicate checkpoint id.",
    });
  }
  if (hasDuplicates(journey.mutations)) {
    context.addIssue({ code: "custom", path: ["mutations"], message: "Duplicate mutation." });
  }
  if (hasDuplicates(journey.allowedRoutes)) {
    context.addIssue({ code: "custom", path: ["allowedRoutes"], message: "Duplicate route." });
  }
  for (const group of ["functional", "keyboard", "accessibility"] as const) {
    if (hasDuplicates(journey.expectations[group])) {
      context.addIssue({
        code: "custom",
        path: ["expectations", group],
        message: "Duplicate expectation.",
      });
    }
  }

  // "none" is a claim about the whole journey, so it cannot sit beside a write.
  if (journey.mutations.includes("none") && journey.mutations.length > 1) {
    context.addIssue({
      code: "custom",
      path: ["mutations"],
      message: "`none` cannot be combined with another mutation.",
    });
  }

  // An unauthenticated visitor cannot write fixture rows through the product.
  if (
    journey.session.kind === "unauthenticated" &&
    journey.mutations.includes("fixture_database_write")
  ) {
    context.addIssue({
      code: "custom",
      path: ["mutations"],
      message: "An unauthenticated journey cannot declare a fixture database write.",
    });
  }

  // An action on an undeclared surface breaks changed-surface expansion: the
  // journey would not be selected when that surface changes.
  const declaredSurfaces = new Set<string>(journey.surfaces);
  for (const [index, action] of journey.actions.entries()) {
    if (!declaredSurfaces.has(action.surface)) {
      context.addIssue({
        code: "custom",
        path: ["actions", index, "surface"],
        message: `Action surface \`${action.surface}\` is not in the journey's declared surfaces.`,
      });
    }
  }

  // A budget the declaration already exceeds can never fail anything.
  if (journey.actions.length > journey.budgets.maxActions) {
    context.addIssue({
      code: "custom",
      path: ["budgets", "maxActions"],
      message: "Declared actions already exceed the action budget.",
    });
  }
});

/**
 * Every scenario carries exactly one classification, and each kind carries the
 * evidence that makes it checkable: a resolvable journey, a covering test that
 * exists on disk, or a written rationale. `.strict()` on each member rejects an
 * entry that mixes two kinds' keys; a scenario classified twice across two
 * entries is rejected by the registry-level refinement below, not here.
 */
export const scenarioCoverageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      scenarioId: personaTestIdSchema,
      kind: z.literal("browser_journey"),
      journeyIds: uniqueArray(slugSchema, "journey id"),
    })
    .strict(),
  z
    .object({
      scenarioId: personaTestIdSchema,
      kind: z.literal("deterministic_non_browser"),
      coveringTests: uniqueArray(nonBlankText, "covering test"),
    })
    .strict(),
  z
    .object({
      scenarioId: personaTestIdSchema,
      kind: z.literal("not_applicable"),
      rationale: nonBlankText,
    })
    .strict(),
  // A scenario that genuinely belongs in a browser journey but whose product
  // surface does not exist yet. Distinct from `not_applicable`, which asserts
  // the scenario has no browser surface at all — recording a blocked scenario
  // as inapplicable would quietly retire it. `trackedBy` makes the deferral
  // recoverable: closing the issue is what removes the entry.
  z
    .object({
      scenarioId: personaTestIdSchema,
      kind: z.literal("deferred"),
      reason: nonBlankText,
      // Issue numbers start at 1, so `#0` and any zero-padded form reference no
      // issue at all. Accepting them would make the deferral unrecoverable by
      // the exact mechanism this field exists to provide.
      trackedBy: z
        .string()
        .regex(/^#[1-9]\d*$/, "Expected a GitHub issue reference such as `#266`."),
    })
    .strict(),
]);

const personaJourneyRegistryShape = z
  .object({
    version: z.literal(personaJourneyRegistryVersion),
    journeys: z.array(personaJourneySchema).min(1),
    // Populated with the exhaustive classification in #241's coverage layer.
    // The schema cannot know the persona matrix's scenario list, so
    // exhaustiveness is enforced by the parity gate, not by a `min(1)` here.
    coverage: z.array(scenarioCoverageSchema).default([]),
  })
  .strict();

export const personaJourneyRegistrySchema = personaJourneyRegistryShape.superRefine(
  (registry, context) => {
    if (hasDuplicates(registry.journeys.map((journey) => journey.journeyId))) {
      context.addIssue({ code: "custom", path: ["journeys"], message: "Duplicate journey id." });
    }

    // AC4's "multiply-classified scenario fails" case: two entries, one id.
    if (hasDuplicates(registry.coverage.map((entry) => entry.scenarioId))) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "A scenario is classified more than once.",
      });
    }
  },
);

export type PersonaRole = (typeof personaRoleValues)[number];
export type JourneySurface = (typeof journeySurfaceValues)[number];
export type JourneyViewport = (typeof journeyViewportValues)[number];
export type JourneyTheme = (typeof journeyThemeValues)[number];
export type JourneyMutation = (typeof journeyMutationValues)[number];
export type JourneyCleanup = (typeof journeyCleanupValues)[number];
export type ScenarioCoverageKind = (typeof scenarioCoverageKindValues)[number];
export type PersonaJourney = z.infer<typeof personaJourneySchema>;
export type ScenarioCoverage = z.infer<typeof scenarioCoverageSchema>;
export type PersonaJourneyRegistry = z.infer<typeof personaJourneyRegistrySchema>;
/** Authoring type: `coverage` is optional here and defaulted on parse. */
export type PersonaJourneyRegistryInput = z.input<typeof personaJourneyRegistrySchema>;
