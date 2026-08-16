/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { personaTestIdValues } from "../../../schemas/loop-manifest";
import type { ScenarioCoverage, ScenarioCoverageKind } from "../../../schemas/persona-journey";
import {
  journeyCleanupForMutations,
  journeyThemeValues,
  journeyViewportValues,
  personaJourneyRegistryId,
  personaJourneyRegistrySchema,
  personaJourneySchema,
  personaRoleByScenarioPrefix,
  personaRolesForScenarioIds,
  personaRoleValues,
  scenarioCoverageKindValues,
  scenarioCoverageSchema,
} from "../../../schemas/persona-journey";
import {
  checkSchemaMirrors,
  renderSchemaMirror,
  schemaMirrors,
  syncSchemaMirrors,
} from "../../../scripts/sync-schemas";

// Resolved from this file rather than `process.cwd()`, so the suite reports
// real drift instead of "missing" when vitest runs from a subdirectory.
type JsonNode = { pattern?: string; uniqueItems?: boolean };

const repoRoot = path.resolve(__dirname, "../../..");

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "loopworks-schema-mirror-"));
  temporaryRoots.push(root);
  return root;
}

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

function validJourney() {
  return {
    journeyId: "operator-route-walk",
    personaTestIds: ["P01"],
    goal: "A signed-in operator walks every portal route slice with a consistent session surface.",
    startState: "One tracked repository, one enabled loop, and one completed run exist.",
    endState: "Every route slice has rendered without an unavailable or error state.",
    surfaces: ["app-shell", "dashboard", "catalog"],
    allowedRoutes: ["/", "/catalog"],
    fixtureWorldId: "operator-active-portal",
    session: { kind: "persona_fixture", sessionProfileId: "operator-primary" },
    actions: [{ id: "open-dashboard", description: "Open the dashboard.", surface: "dashboard" }],
    checkpoints: [{ id: "dashboard-renders", description: "The dashboard names the repository." }],
    expectations: {
      functional: ["Every route slice renders its own heading."],
      keyboard: ["Primary navigation is reachable in document order."],
      accessibility: ["axe reports no violations on each route slice."],
    },
    viewports: ["mobile", "desktop"],
    themes: ["light", "dark"],
    mutations: ["none"],
    budgets: { maxDurationMs: 60_000, maxActions: 25 },
  };
}

/**
 * Routes the product's own specs already drive. If the contract cannot express
 * these, the journeys in the sibling layers cannot declare where they go.
 */
const acceptedRoutes = [
  "/",
  "/catalog",
  "/catalog/",
  "/loops/register",
  "/settings/repositories",
  "/github",
  // tests/e2e/day-zero-activation.spec.ts drives both of these.
  "/settings?github=cancelled",
  "/settings?github=no-installation-found",
  // src/app/sign-in/page.tsx reads `error` and `callbackUrl` from searchParams.
  "/sign-in?error=AccessDenied&callbackUrl=%2F",
  "/runs?run=fixture-run-research",
  "/runs/[id]",
  "/page#frag",
  "/.well-known/x",
  "/.foo",
] as const;

const rejectedRoutes = [
  "https://evil.com",
  "//evil.com",
  // `new URL("//", base)` cannot be parsed at all.
  "//",
  "//?a=1",
  "catalog",
  "",
  "/../admin",
  "/..",
  "/a/../b",
  "/.",
  "/./a",
  "/a/..",
  // Percent-encoded traversal. `new URL("/%2e%2e/admin", base)` resolves to
  // `/admin`, so a literal-dot guard alone lets the declared route and the
  // navigated route be different paths.
  "/%2e%2e/admin",
  "/%2E%2E/admin",
  "/.%2e/admin",
  "/%2e./admin",
  "/a/%2e%2e/b",
  "/a/..%2fb",
  "/..%2f",
  "/%2f%2fevil.com",
  "/a b",
  "/a\tb",
] as const;

describe("persona journey schema", () => {
  it("accepts a complete journey entry", () => {
    expect(() => personaJourneySchema.parse(validJourney())).not.toThrow();
  });

  it("expresses every route the product's browser scenarios already use", () => {
    for (const route of acceptedRoutes) {
      expect(
        personaJourneySchema.safeParse({ ...validJourney(), allowedRoutes: [route] }).success,
        route,
      ).toBe(true);
    }
  });

  it("rejects absolute, protocol-relative, and traversal routes", () => {
    for (const route of rejectedRoutes) {
      expect(
        personaJourneySchema.safeParse({ ...validJourney(), allowedRoutes: [route] }).success,
        route,
      ).toBe(false);
    }
  });

  it("constrains viewports and themes to declared values rather than free text", () => {
    expect(journeyViewportValues).toEqual(["mobile", "tablet", "desktop"]);
    expect(journeyThemeValues).toEqual(["light", "dark"]);

    expect(() =>
      personaJourneySchema.parse({ ...validJourney(), viewports: ["ultrawide"] }),
    ).toThrow();
    expect(() => personaJourneySchema.parse({ ...validJourney(), themes: ["sepia"] })).toThrow();
  });

  it("rejects a free-text budget while both budget keys are present", () => {
    // Both keys stay present so the failure is the string type, not a missing
    // key: otherwise this passes even if maxDurationMs were declared a string.
    const freeText = personaJourneySchema.safeParse({
      ...validJourney(),
      budgets: { maxDurationMs: "fast", maxActions: 25 },
    });
    expect(freeText.success).toBe(false);
    expect(JSON.stringify(freeText.error?.issues)).toContain("maxDurationMs");

    const fractional = personaJourneySchema.safeParse({
      ...validJourney(),
      budgets: { maxDurationMs: 60_000.5, maxActions: 25 },
    });
    expect(fractional.success).toBe(false);
  });

  it("bounds budgets at both ends", () => {
    for (const budgets of [
      { maxDurationMs: 999, maxActions: 25 },
      { maxDurationMs: 600_001, maxActions: 25 },
      { maxDurationMs: 60_000, maxActions: 0 },
      { maxDurationMs: 60_000, maxActions: 201 },
    ]) {
      expect(
        personaJourneySchema.safeParse({ ...validJourney(), budgets }).success,
        JSON.stringify(budgets),
      ).toBe(false);
    }
  });

  it("rejects unknown persona ids, unknown keys, and empty required collections", () => {
    expect(() =>
      personaJourneySchema.parse({ ...validJourney(), personaTestIds: ["P99"] }),
    ).toThrow();
    expect(() => personaJourneySchema.parse({ ...validJourney(), unexpected: "value" })).toThrow();
    expect(() => personaJourneySchema.parse({ ...validJourney(), surfaces: [] })).toThrow();
    expect(() => personaJourneySchema.parse({ ...validJourney(), checkpoints: [] })).toThrow();
  });

  it("rejects blank text where a written justification is required", () => {
    expect(() => personaJourneySchema.parse({ ...validJourney(), goal: "   " })).toThrow();
    expect(() =>
      scenarioCoverageSchema.parse({ scenarioId: "M03", kind: "not_applicable", rationale: " " }),
    ).toThrow();
  });

  it("expresses an unauthenticated journey without inventing a session profile", () => {
    const unauthenticated = {
      ...validJourney(),
      journeyId: "unauthenticated-orientation",
      session: { kind: "unauthenticated" },
    };

    expect(() => personaJourneySchema.parse(unauthenticated)).not.toThrow();
    expect(() =>
      personaJourneySchema.parse({
        ...validJourney(),
        session: { kind: "unauthenticated", sessionProfileId: "operator-primary" },
      }),
    ).toThrow();
  });

  it("versions the registry and rejects an unknown version", () => {
    const registry = { version: 1, journeys: [validJourney()] };

    expect(personaJourneyRegistrySchema.parse(registry).version).toBe(1);
    expect(() => personaJourneyRegistrySchema.parse({ ...registry, version: 2 })).toThrow();
    expect(personaJourneyRegistryId).toBe("loopworks.persona_journey.v1");
  });
});

describe("journey coherence invariants", () => {
  it("rejects a journey whose declaration contradicts itself", () => {
    const contradictions: Array<[string, Record<string, unknown>]> = [
      ["`none` beside a write", { mutations: ["none", "fixture_database_write"] }],
      [
        "an action on an undeclared surface",
        {
          surfaces: ["dashboard"],
          actions: [{ id: "open-approvals", description: "Open.", surface: "approvals" }],
        },
      ],
      [
        "more actions than the action budget",
        {
          actions: [
            { id: "one", description: "One.", surface: "dashboard" },
            { id: "two", description: "Two.", surface: "dashboard" },
          ],
          budgets: { maxDurationMs: 60_000, maxActions: 1 },
        },
      ],
      ["duplicate scenario ids", { personaTestIds: ["P01", "P01"] }],
      ["duplicate themes", { themes: ["light", "light"] }],
      ["duplicate mutations", { mutations: ["browser_storage_write", "browser_storage_write"] }],
      ["duplicate routes", { allowedRoutes: ["/", "/"] }],
      ["duplicate viewports", { viewports: ["desktop", "desktop"] }],
      [
        "duplicate action ids",
        {
          actions: [
            { id: "same", description: "One.", surface: "dashboard" },
            { id: "same", description: "Two.", surface: "dashboard" },
          ],
        },
      ],
      [
        "duplicate checkpoint ids",
        {
          checkpoints: [
            { id: "same", description: "One." },
            { id: "same", description: "Two." },
          ],
        },
      ],
    ];

    for (const [label, override] of contradictions) {
      expect(
        personaJourneySchema.safeParse({ ...validJourney(), ...override }).success,
        label,
      ).toBe(false);
    }
  });

  it("derives persona roles from scenario prefixes instead of storing them", () => {
    // The registry has no persona field: the role is a pure function of the
    // scenario IDs, so storing it could only add a second place to be wrong.
    expect(personaRolesForScenarioIds(["P01"])).toEqual(["product_operator"]);
    expect(personaRolesForScenarioIds(["S01", "M02"]).sort()).toEqual([
      "maintainer",
      "security_reviewer",
    ]);
    expect(personaRolesForScenarioIds(["P01", "P05"])).toEqual(["product_operator"]);

    expect(
      personaJourneySchema.safeParse({ ...validJourney(), personas: ["reviewer"] }).success,
      "a stored persona field must not be accepted",
    ).toBe(false);
  });

  it("derives distinct cleanup obligations from mutations", () => {
    // P04 writes browser storage and never touches the database, so it must not
    // be forced to instruct #242 to reset a fixture world it never wrote to.
    expect(journeyCleanupForMutations(["none"])).toEqual([]);
    expect(journeyCleanupForMutations(["browser_storage_write"])).toEqual([
      "browser_storage_reset",
    ]);
    expect(journeyCleanupForMutations(["fixture_database_write"])).toEqual([
      "fixture_database_reset",
    ]);
    expect(
      journeyCleanupForMutations(["fixture_database_write", "browser_storage_write"]).sort(),
    ).toEqual(["browser_storage_reset", "fixture_database_reset"]);
  });

  it("maps every scenario prefix to a role and reaches every role", () => {
    // Totality: no scenario id can fail to resolve a persona. Surjectivity: no
    // declared role is unreachable. Derived from the ID vocabulary itself, so
    // this pins a machine-consumed mapping rather than document prose.
    const prefixes = new Set([...personaTestIdValues].map((id) => id[0]));

    expect([...prefixes].sort()).toEqual(Object.keys(personaRoleByScenarioPrefix).sort());
    expect([...new Set(Object.values(personaRoleByScenarioPrefix))].sort()).toEqual(
      [...personaRoleValues].sort(),
    );
  });

  it("rejects duplicates in every declared collection", () => {
    for (const [label, override] of [
      ["mutations", { mutations: ["browser_storage_write", "browser_storage_write"] }],
      ["allowedRoutes", { allowedRoutes: ["/", "/"] }],
      [
        "expectations",
        {
          expectations: {
            functional: ["same", "same"],
            keyboard: ["k"],
            accessibility: ["a"],
          },
        },
      ],
    ] as Array<[string, Record<string, unknown>]>) {
      expect(
        personaJourneySchema.safeParse({ ...validJourney(), ...override }).success,
        label,
      ).toBe(false);
    }

    expect(
      scenarioCoverageSchema.safeParse({
        scenarioId: "P01",
        kind: "browser_journey",
        journeyIds: ["a", "a"],
      }).success,
    ).toBe(false);
    expect(
      scenarioCoverageSchema.safeParse({
        scenarioId: "P02",
        kind: "deterministic_non_browser",
        coveringTests: ["t", "t"],
      }).success,
    ).toBe(false);
  });

  it("rejects a duplicate journey id and a scenario classified twice", () => {
    const journey = validJourney();

    expect(
      personaJourneyRegistrySchema.safeParse({ version: 1, journeys: [journey, journey] }).success,
    ).toBe(false);

    expect(
      personaJourneyRegistrySchema.safeParse({
        version: 1,
        journeys: [journey],
        coverage: [
          { scenarioId: "P01", kind: "not_applicable", rationale: "One." },
          { scenarioId: "P01", kind: "browser_journey", journeyIds: ["operator-route-walk"] },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("scenario coverage classification", () => {
  it("keeps the exported kind vocabulary aligned with what the schema accepts", () => {
    // Both directions. Checking only that every exported kind parses would
    // miss the direction that actually matters: a union member with no entry
    // in the array, which a layer-3 gate iterating the array would skip.
    const accepted = scenarioCoverageKindValues.filter((kind) => {
      const candidate: Record<string, unknown> = { scenarioId: "P01", kind };
      if (kind === "browser_journey") candidate.journeyIds = ["x"];
      if (kind === "deterministic_non_browser") candidate.coveringTests = ["x"];
      if (kind === "not_applicable") candidate.rationale = "x";
      return scenarioCoverageSchema.safeParse(candidate).success;
    });
    expect(accepted).toEqual([...scenarioCoverageKindValues]);

    // The reverse direction — a union member with no array entry — is checked
    // at compile time rather than by reaching into Zod's private node layout,
    // which a Zod bump could rearrange.
    type UnionKind = ScenarioCoverage["kind"];
    type MissingFromArray = Exclude<UnionKind, ScenarioCoverageKind>;
    type MissingFromUnion = Exclude<ScenarioCoverageKind, UnionKind>;
    const _bothDirections: [MissingFromArray, MissingFromUnion] extends [never, never]
      ? true
      : never = true;
    expect(_bothDirections).toBe(true);

    expect(() => scenarioCoverageSchema.parse({ scenarioId: "P01", kind: "someday" })).toThrow();
  });

  it("requires each kind to carry its own evidence and no other kind's", () => {
    expect(() =>
      scenarioCoverageSchema.parse({ scenarioId: "P01", kind: "browser_journey", journeyIds: [] }),
    ).toThrow();
    expect(() =>
      scenarioCoverageSchema.parse({ scenarioId: "P02", kind: "deterministic_non_browser" }),
    ).toThrow();
    expect(() =>
      scenarioCoverageSchema.parse({ scenarioId: "M03", kind: "not_applicable" }),
    ).toThrow();
    expect(() =>
      scenarioCoverageSchema.parse({
        scenarioId: "P01",
        kind: "browser_journey",
        journeyIds: ["operator-route-walk"],
        rationale: "Also not applicable.",
      }),
    ).toThrow();
  });

  it("rejects a scenario id that is not a known persona test id", () => {
    expect(() =>
      scenarioCoverageSchema.parse({
        scenarioId: "P99",
        kind: "not_applicable",
        rationale: "Invented.",
      }),
    ).toThrow();
  });
});

describe("sync-schemas", () => {
  it("declares at least one mirror", () => {
    // The loops below would pass vacuously against an empty list.
    expect(schemaMirrors.length).toBeGreaterThan(0);
  });

  it("keeps the checked-in JSON mirror identical to a fresh generation", async () => {
    const result = await checkSchemaMirrors(repoRoot);

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, missing: [], stale: [] });
  });

  it("marks the generated file and carries the versioned contract id", async () => {
    const mirror = JSON.parse(
      await readFile(path.join(repoRoot, schemaMirrors[0].target), "utf8"),
    ) as { $id: string; $comment: string; $schema: string; title: string };

    // `$id` resolves to the artifact's own path, matching the convention
    // `schemas/loop-manifest.schema.json` already follows, and the path itself
    // is versioned so a v2 collides on neither the id nor the file.
    expect(mirror.$id.endsWith(path.basename(schemaMirrors[0].target))).toBe(true);
    expect(schemaMirrors[0].target).toContain(".v1.");
    expect(mirror.title).toContain(personaJourneyRegistryId);
    expect(mirror.$comment).toContain("Do not edit");
    expect(mirror.$comment).toContain("schemas:sync");
    expect(mirror.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("mirrors the route constraint faithfully instead of dropping it", async () => {
    // `z.toJSONSchema` drops `.refine()` silently. The traversal guard lives in
    // the pattern for exactly that reason; this differential check fails if it
    // ever moves back into a refinement, which no freshness check can catch.
    const mirror = JSON.parse(
      await readFile(path.join(repoRoot, schemaMirrors[0].target), "utf8"),
    ) as Record<string, never>;

    const routeNode = (
      mirror as unknown as {
        properties: {
          journeys: { items: { properties: { allowedRoutes: { items: { pattern: string } } } } };
        };
      }
    ).properties.journeys.items.properties.allowedRoutes.items;

    expect(routeNode.pattern, "mirror lost the route pattern").toBeTruthy();
    const mirrored = new RegExp(routeNode.pattern);

    for (const route of [...acceptedRoutes, ...rejectedRoutes]) {
      // Compared against the schema, not against the regex constant the mirror
      // is generated from. Comparing that constant to itself stays green even
      // when a `.refine()` layered on top narrows Zod and not the mirror.
      const schemaAccepts = personaJourneySchema.safeParse({
        ...validJourney(),
        allowedRoutes: [route],
      }).success;

      expect(
        mirrored.test(route),
        `mirror disagrees with the schema on ${JSON.stringify(route)}`,
      ).toBe(schemaAccepts);
    }
  });

  it("mirrors every single-field constraint family, not only routes", async () => {
    // The route check below is the tripwire for a constraint moving into a
    // dropped refinement. That risk was never route-specific: the same mistake
    // in nonBlankText, the slug pattern, or a budget bound would be invisible.
    const mirror = JSON.parse(
      await readFile(path.join(repoRoot, schemaMirrors[0].target), "utf8"),
    ) as Record<string, never>;

    const journeyProps = (
      mirror as unknown as {
        properties: { journeys: { items: { properties: Record<string, JsonNode> } } };
      }
    ).properties.journeys.items.properties;

    // Non-blank text survives as a pattern.
    expect(journeyProps.goal.pattern, "nonBlankText lost its pattern").toBeTruthy();
    expect(new RegExp(journeyProps.goal.pattern as string).test("   ")).toBe(false);

    // Slug ids survive as a pattern.
    expect(journeyProps.journeyId.pattern, "slug lost its pattern").toBeTruthy();
    expect(new RegExp(journeyProps.journeyId.pattern as string).test("Bad Id")).toBe(false);

    // Budget bounds survive as numeric limits.
    const budgets = journeyProps.budgets as unknown as {
      properties: { maxDurationMs: { minimum: number; maximum: number } };
    };
    expect(budgets.properties.maxDurationMs.minimum).toBe(1_000);
    expect(budgets.properties.maxDurationMs.maximum).toBe(600_000);

    // Uniqueness survives as `uniqueItems` rather than being demoted to a
    // Zod-only refinement: it is a core JSON Schema keyword and Zod emits it.
    for (const field of ["personaTestIds", "surfaces", "allowedRoutes", "viewports", "themes"]) {
      expect(journeyProps[field].uniqueItems, `${field} lost uniqueItems`).toBe(true);
    }
  });

  it("declares every generated mirror on disk, leaving no orphan from a version bump", async () => {
    // `target` is templated off the registry version, so a bump writes a new
    // file and leaves the old one unchecked and un-formatted.
    const { readdir } = await import("node:fs/promises");
    const present = (await readdir(path.join(repoRoot, "schemas")))
      .filter((name) => /^persona-journey\.v\d+\.schema\.json$/.test(name))
      .sort();

    expect(present).toEqual(schemaMirrors.map((mirror) => path.basename(mirror.target)).sort());
  });

  it("states in the artifact that the mirror is a structural subset", async () => {
    // A reader holding only the JSON has no way to discover the cross-field
    // rules, so the file says so itself rather than a prose array in the source
    // claiming a boundary that no test can bind to a refinement.
    const mirror = JSON.parse(
      await readFile(path.join(repoRoot, schemaMirrors[0].target), "utf8"),
    ) as { $comment: string };

    expect(mirror.$comment).toContain("Cross-field invariants");
  });

  it("reports a missing mirror and a stale mirror distinctly", async () => {
    const root = await temporaryRoot();

    await expect(checkSchemaMirrors(root)).resolves.toMatchObject({
      ok: false,
      missing: schemaMirrors.map((mirror) => mirror.target),
      stale: [],
    });

    await mkdir(path.join(root, "schemas"), { recursive: true });
    for (const mirror of schemaMirrors) {
      await writeFile(path.join(root, mirror.target), '{"stale":true}\n');
    }
    await expect(checkSchemaMirrors(root)).resolves.toMatchObject({
      ok: false,
      missing: [],
      stale: schemaMirrors.map((mirror) => mirror.target),
    });
  });

  it("creates the target directory and writes idempotently", async () => {
    // No pre-made `schemas/`: --write must create it rather than throw ENOENT.
    const root = await temporaryRoot();

    await expect(syncSchemaMirrors(root)).resolves.toMatchObject({
      changed: schemaMirrors.map((mirror) => mirror.target),
    });
    for (const mirror of schemaMirrors) {
      await expect(readFile(path.join(root, mirror.target), "utf8")).resolves.toBe(
        renderSchemaMirror(mirror),
      );
    }
    await expect(syncSchemaMirrors(root)).resolves.toMatchObject({ ok: true, changed: [] });
  });

  it("keeps every generated mirror out of the Biome formatter", async () => {
    const biome = JSON.parse(await readFile(path.join(repoRoot, "biome.json"), "utf8")) as {
      files: { includes: string[] };
    };

    for (const mirror of schemaMirrors) {
      const negation = `!${mirror.target}`;
      expect(biome.files.includes, mirror.target).toContain(negation);
      // A positive pattern after the negation would re-include the file.
      const after = biome.files.includes.slice(biome.files.includes.indexOf(negation) + 1);
      expect(after.filter((pattern) => !pattern.startsWith("!"))).toEqual([]);
    }
  });

  it("proves the Biome exclusion is load-bearing rather than decorative", async () => {
    // If Biome agreed with the generator, the exclusion would be noise. It does
    // not: Biome collapses short arrays that JSON.stringify expands, so with
    // the file included `check` and `schemas:check` would each undo the other.
    const biomeBinary = path.join(repoRoot, "node_modules/.bin/biome");
    expect(existsSync(biomeBinary), "biome binary missing; this check must not skip").toBe(true);

    const generated = renderSchemaMirror(schemaMirrors[0]);
    const formatted = execFileSync(
      biomeBinary,
      [
        // Deliberately NOT the real target path: that path is excluded, so
        // Biome would echo the input and the check would prove nothing.
        "format",
        "--stdin-file-path=mirror-format-probe.json",
      ],
      { input: generated, encoding: "utf8" },
    );

    expect(formatted).not.toBe(generated);
  });

  it("wires generation and drift checks into package scripts and CI", async () => {
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["schemas:sync"]).toContain("sync-schemas.ts --write");
    expect(packageJson.scripts["schemas:check"]).toContain("sync-schemas.ts --check");
    expect(packageJson.scripts.validate).toContain("bun run schemas:check");

    const workflow = await readFile(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(workflow).toContain("bun run schemas:check");
  });
});
