/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { personaJourneyRegistry } from "@/lib/personas/journey-registry";
import { personaTestIdValues } from "../../../schemas/loop-manifest";
import {
  type PersonaJourneyRegistry,
  personaJourneyRegistrySchema,
  type ScenarioCoverage,
  type ScenarioCoverageKind,
} from "../../../schemas/persona-journey";
import vitestConfig from "../../../vitest.config";
import {
  browserApplicableScenarioIds,
  deferralSection,
  deferralSectionFrom,
  e2ePersonaClaims,
  personaAnnotationsIn,
  personaMatrixRows,
  repoRoot,
  specsWithoutPersonaClaims,
} from "../../helpers/persona-matrix";

/**
 * Each gate is a function over a registry that returns the violations it finds.
 *
 * Written this way so the negative cases below can hand it a deliberately
 * broken registry. A gate that only ever runs against the real data proves the
 * data is currently fine; it never proves the gate would notice if it were not,
 * which is the only property that matters for a CI check.
 */
type Gate = (registry: PersonaJourneyRegistry) => string[];

function ofKind<Kind extends ScenarioCoverageKind>(
  registry: PersonaJourneyRegistry,
  kind: Kind,
): Extract<ScenarioCoverage, { kind: Kind }>[] {
  return registry.coverage.filter(
    (entry): entry is Extract<ScenarioCoverage, { kind: Kind }> => entry.kind === kind,
  );
}

/** A `browser_journey` must name journeys that exist and claim it back. */
const journeysResolveAndClaimBack: Gate = (registry) => {
  const journeys = new Map(registry.journeys.map((journey) => [journey.journeyId, journey]));

  return ofKind(registry, "browser_journey").flatMap((entry) =>
    entry.journeyIds.flatMap((journeyId) => {
      const journey = journeys.get(journeyId);
      if (!journey) return [`${entry.scenarioId} names unknown journey ${journeyId}`];

      // Resolution alone would accept P01 pointing at the theme journey.
      return (journey.personaTestIds as readonly string[]).includes(entry.scenarioId)
        ? []
        : [`${journeyId} does not claim ${entry.scenarioId} back`];
    }),
  );
};

/** Every scenario a journey runs for must be classified `browser_journey`. */
const journeyScenariosAreClassifiedBrowser: Gate = (registry) => {
  const browser = new Set(ofKind(registry, "browser_journey").map((entry) => entry.scenarioId));

  return registry.journeys.flatMap((journey) =>
    journey.personaTestIds
      .filter((scenarioId) => !browser.has(scenarioId))
      .map((scenarioId) => `${journey.journeyId} covers unclassified ${scenarioId}`),
  );
};

/**
 * Suites the default Vitest lane skips, read from the config that skips them.
 *
 * Evidence `bun run test` never executes is not evidence `bun run validate` can
 * act on. Those lanes do run elsewhere in CI, so this is about which gate can
 * rely on the evidence, not about whether it runs at all. `tests/e2e/**` is
 * excluded twice over: a kind meaning "covered without a browser" may not cite
 * a browser spec.
 *
 * Derived rather than restated. A hand-copied pair of prefixes is a second copy
 * of the exclusion list, and if the config gained a lane the stale copy here
 * would quietly readmit evidence the suite never runs.
 */
function excludedFromDefaultLane(): string[] {
  return (vitestConfig.test?.exclude ?? []).map((pattern) => {
    // Prefix matching is only sound for directory globs. A pattern like
    // `**/*.native.test.ts` would derive to itself and match nothing, silently
    // readmitting the evidence this derivation exists to keep out — so an
    // unexpected shape fails here rather than weakening the gate in silence.
    if (!/^[\w./-]+\/\*\*$/.test(pattern)) {
      throw new Error(`Unsupported vitest exclude pattern for lane checking: ${pattern}`);
    }
    return pattern.replace(/\*\*$/, "");
  });
}

/**
 * A covering test must run in CI, exist, and annotate the scenario.
 *
 * Existence alone is not evidence: any test file in the repository satisfies
 * it, so a classification could point at a suite with nothing to do with the
 * scenario. Requiring the scenario id makes the reference bidirectional, which
 * is what AC3 asks of executable test references — and requiring it in a
 * comment stops an incidental mention inside a string literal from counting,
 * which this very file would otherwise supply for several scenario ids.
 */
const coveringTestsResolveAndNameTheScenario: Gate = (registry) =>
  ofKind(registry, "deterministic_non_browser").flatMap((entry) =>
    entry.coveringTests.flatMap((coveringTest) => {
      // No `.` or `..` segment. The regex alone cannot reject them — its
      // character class contains a dot — and a traversing path resolves
      // outside the repository, where existsSync confirms something unrelated.
      if (
        !/^tests(?:\/[\w.-]+)*\/[\w.-]+\.(?:test|spec)\.tsx?$/.test(coveringTest) ||
        coveringTest.split("/").some((segment) => segment === ".." || segment === ".")
      ) {
        return [`${entry.scenarioId} covering test is not a repo-relative test path`];
      }
      if (excludedFromDefaultLane().some((prefix) => coveringTest.startsWith(prefix))) {
        return [`${entry.scenarioId} cites ${coveringTest}, which the default test lane skips`];
      }
      if (!existsSync(path.join(repoRoot, coveringTest))) {
        return [`${entry.scenarioId} names missing ${coveringTest}`];
      }

      const source = readFileSync(path.join(repoRoot, coveringTest), "utf8");
      if (!personaAnnotationsIn(source).has(entry.scenarioId)) {
        return [`${coveringTest} does not annotate Persona ${entry.scenarioId}`];
      }
      return [];
    }),
  );

/**
 * A deferral must name any browser spec that already exercises the scenario.
 *
 * This enforces mention, not truth. A reason that names the spec and then
 * misdescribes it still passes, and so does one whose citation is incidental —
 * R02 cites `portal.spec.ts` for the design-token half and would satisfy this
 * gate for free if that spec ever annotated R02. What the gate buys is that an
 * author cannot write a deferral without confronting the spec, which is the
 * failure it was built for: three reasons here once asserted that surfaces did
 * not exist while green specs drove them. Whether the resulting sentence is
 * accurate stays a reviewer's judgement.
 */
const deferralsNameExistingSpecs: Gate = (registry) => {
  const claims = e2ePersonaClaims();

  return ofKind(registry, "deferred").flatMap((entry) =>
    (claims.get(entry.scenarioId) ?? [])
      .filter((spec) => !entry.reason.includes(spec))
      .map((spec) => `${entry.scenarioId} is deferred but ${spec} already exercises it`),
  );
};

/**
 * The matrix's deferral section must name exactly the deferred scenarios.
 *
 * A gate over the narrative rather than the registry, so the two cannot drift
 * in either direction.
 */
const matrixDeferralSectionMatchesRegistryUsing =
  (readSection: () => string | undefined): Gate =>
  (registry) => {
    const section = readSection();
    if (section === undefined)
      return ["the persona matrix has no Deferred Browser Coverage section"];

    const deferred = new Set<string>(ofKind(registry, "deferred").map((entry) => entry.scenarioId));
    const noted = new Set(
      Array.from(section.matchAll(/\b([PMARS]\d{2})\b/g), ([, id]) => id as string),
    );

    return [
      ...[...deferred].filter((id) => !noted.has(id)).map((id) => `${id} is deferred, unnoted`),
      ...[...noted]
        .filter((id) => !deferred.has(id))
        .map((id) => `the matrix defers ${id}, unlisted`),
    ];
  };

const matrixDeferralSectionMatchesRegistry =
  matrixDeferralSectionMatchesRegistryUsing(deferralSection);

/** Evidence prose must be substantive, and any path it cites must resolve. */
const writtenEvidenceIsSubstantiveAndResolvable: Gate = (registry) =>
  registry.coverage.flatMap((entry) => {
    const prose =
      entry.kind === "deferred"
        ? entry.reason
        : entry.kind === "not_applicable"
          ? entry.rationale
          : null;
    if (prose === null) return [];

    const violations =
      prose.trim().length > 80 ? [] : [`${entry.scenarioId} evidence is too thin to act on`];

    // A reason that cites a file is only as true as that path. Renaming what it
    // points at would otherwise falsify the prose silently.
    for (const [citedPath] of prose.matchAll(/\b(?:src|tests|docs)\/[\w./-]+\.\w+\b/g)) {
      if (!existsSync(path.join(repoRoot, citedPath))) {
        violations.push(`${entry.scenarioId} cites missing ${citedPath}`);
      }
    }

    return violations;
  });

/** The kind must agree with the matrix about what is browser work. */
const kindAgreesWithTheMatrix: Gate = (registry) => {
  const browserApplicable = new Set(browserApplicableScenarioIds());
  const expectsBrowser: Record<ScenarioCoverageKind, boolean> = {
    browser_journey: true,
    deferred: true,
    deterministic_non_browser: false,
    not_applicable: false,
  };

  return registry.coverage
    .filter((entry) => browserApplicable.has(entry.scenarioId) !== expectsBrowser[entry.kind])
    .map((entry) => `${entry.scenarioId} is ${entry.kind}, against its matrix coverage column`);
};

const gates: Record<string, Gate> = {
  journeysResolveAndClaimBack,
  journeyScenariosAreClassifiedBrowser,
  coveringTestsResolveAndNameTheScenario,
  deferralsNameExistingSpecs,
  matrixDeferralSectionMatchesRegistry,
  writtenEvidenceIsSubstantiveAndResolvable,
  kindAgreesWithTheMatrix,
};

/** The shipped registry with `coverage` replaced, reparsed through the schema. */
function withCoverage(entries: unknown[]) {
  return personaJourneyRegistrySchema.safeParse({ ...personaJourneyRegistry, coverage: entries });
}

/** Parse a mutated registry that is expected to remain schema-valid. */
function mutate(scenarioId: string, entry: ScenarioCoverage): PersonaJourneyRegistry {
  const parsed = withCoverage(
    personaJourneyRegistry.coverage.map((existing) =>
      existing.scenarioId === scenarioId ? entry : existing,
    ),
  );
  if (!parsed.success) throw new Error(`Mutant was not schema-valid: ${parsed.error.message}`);
  return parsed.data;
}

const padding = "Padding to clear the substance floor. ".repeat(3);

/**
 * Run a gate by name, recording that it was exercised.
 *
 * Routing through the record means an unregistered gate has no test. The
 * recording closes the other direction: a registered gate with no mutation case
 * fails the coverage assertion below. Two gates shipped in exactly that state —
 * the excluded-lane branch and comment anchoring — while the ADR listed both as
 * established properties.
 */
const exercised = new Set<string>();

function runGate(name: keyof typeof gates, mutant: PersonaJourneyRegistry): string[] {
  const gate = gates[name];
  if (!gate) throw new Error(`No gate registered as ${String(name)}`);
  if (mutant === personaJourneyRegistry) {
    throw new Error(`${String(name)} must be exercised against a mutated registry`);
  }

  const violations = gate(mutant);
  // Recorded only when the gate actually reported something. Recording on
  // invocation alone would let `runGate(name, mutant)` asserting `[]` satisfy
  // the coverage check below without demonstrating the gate can fail.
  if (violations.length > 0) exercised.add(name as string);
  return violations;
}

describe("persona scenario coverage", () => {
  it("passes every gate against the shipped registry", () => {
    for (const [name, gate] of Object.entries(gates)) {
      expect(gate(personaJourneyRegistry), name).toEqual([]);
    }
  });

  it("leaves no browser spec outside the persona annotation convention", () => {
    // `deferralsNameExistingSpecs` reads those annotations, so a spec carrying
    // none is coverage the gate silently cannot see — which is exactly how
    // sign-in.spec.ts and day-zero-activation.spec.ts once hid P05, M04, M05,
    // and S07 from it. A floor, not a guarantee: removing one annotation from a
    // spec that still has others stays undetectable.
    expect(specsWithoutPersonaClaims()).toEqual([]);
  });

  it("classifies each documented scenario against a matrix that parsed cleanly", () => {
    // A padded cell would drop one row and silently narrow every matrix-derived
    // gate above, so the row count is pinned to the classification rather than
    // merely being non-zero. Exhaustiveness itself is the parity gate in
    // tests/unit/loops/manifest.test.ts.
    expect(personaMatrixRows().length).toBe(personaTestIdValues.length);
    expect(personaJourneyRegistry.coverage.length).toBe(personaTestIdValues.length);
  });

  describe("gates catch the mutations they exist for", () => {
    it("catches a browser_journey naming a journey that does not exist", () => {
      const mutant = mutate("P04", {
        scenarioId: "P04",
        kind: "browser_journey",
        journeyIds: ["theme-persistance"],
      });

      expect(runGate("journeysResolveAndClaimBack", mutant)).toEqual([
        "P04 names unknown journey theme-persistance",
      ]);
    });

    it("catches a browser_journey naming a real journey that does not claim it back", () => {
      const mutant = mutate("P04", {
        scenarioId: "P04",
        kind: "browser_journey",
        journeyIds: ["operator-route-walk"],
      });

      expect(runGate("journeysResolveAndClaimBack", mutant)).toEqual([
        "operator-route-walk does not claim P04 back",
      ]);
    });

    it("catches a journey whose scenario is classified as something other than browser work", () => {
      // The converse direction: a journey runs for P04 while the classification
      // says P04 is covered without a browser.
      const mutant = mutate("P04", {
        scenarioId: "P04",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/unit/personas/journey-coverage.test.ts"],
      });

      expect(runGate("journeyScenariosAreClassifiedBrowser", mutant)).toEqual([
        "theme-persistence covers unclassified P04",
      ]);
    });

    it("catches a covering test path that does not exist", () => {
      const mutant = mutate("M03", {
        scenarioId: "M03",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/unit/vercel/clients.test.ts"],
      });

      expect(runGate("coveringTestsResolveAndNameTheScenario", mutant)).toEqual([
        "M03 names missing tests/unit/vercel/clients.test.ts",
      ]);
    });

    it("catches a covering test path that traverses out of the repository", () => {
      const mutant = mutate("M03", {
        scenarioId: "M03",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/../../etc/passwd.test.ts"],
      });

      expect(runGate("coveringTestsResolveAndNameTheScenario", mutant)).toEqual([
        "M03 covering test is not a repo-relative test path",
      ]);
    });

    it("catches a covering test in a lane the default suite never runs", () => {
      // Both prefixes come from vitest.config.ts. Without this the branch never
      // executed against any registry, real or mutated, while the ADR listed it
      // as a property the suite establishes.
      expect(excludedFromDefaultLane()).toContain("tests/e2e/");

      const mutant = mutate("M03", {
        scenarioId: "M03",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/e2e/portal.spec.ts"],
      });

      expect(runGate("coveringTestsResolveAndNameTheScenario", mutant)).toEqual([
        "M03 cites tests/e2e/portal.spec.ts, which the default test lane skips",
      ]);
    });

    it("catches a scenario id that appears only inside a string literal", () => {
      // This file mentions the M03 annotation only inside an expected-violation
      // string, never in a comment, so it is the exact case the unanchored
      // substring check used to accept. Without this the anchoring change had
      // no test distinguishing it from the old behaviour. Do not spell the
      // annotation out in a comment here — doing so makes this file annotate
      // itself, the gate returns no violation, and this test fails.
      const mutant = mutate("M03", {
        scenarioId: "M03",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/unit/personas/journey-coverage.test.ts"],
      });

      expect(runGate("coveringTestsResolveAndNameTheScenario", mutant)).toEqual([
        "tests/unit/personas/journey-coverage.test.ts does not annotate Persona M03",
      ]);
    });

    it("catches a covering test that exists but does not cover the scenario", () => {
      // The gate's whole point: any test file passes a bare existence check.
      const mutant = mutate("M03", {
        scenarioId: "M03",
        kind: "deterministic_non_browser",
        coveringTests: ["tests/unit/loops/manifest.test.ts"],
      });

      expect(runGate("coveringTestsResolveAndNameTheScenario", mutant)).toEqual([
        "tests/unit/loops/manifest.test.ts does not annotate Persona M03",
      ]);
    });

    it("catches a deferral that ignores a spec already exercising the scenario", () => {
      const mutant = mutate("M02", {
        scenarioId: "M02",
        kind: "deferred",
        reason: `No browser surface exists for this scenario at all. ${padding}`,
        trackedBy: "#266",
      });

      expect(runGate("deferralsNameExistingSpecs", mutant)).toEqual([
        "M02 is deferred but tests/e2e/portal.spec.ts already exercises it",
      ]);
    });

    it("catches evidence reduced to a stub", () => {
      const mutant = mutate("S05", {
        scenarioId: "S05",
        kind: "deferred",
        reason: "Blocked.",
        trackedBy: "#266",
      });

      expect(runGate("writtenEvidenceIsSubstantiveAndResolvable", mutant)).toEqual([
        "S05 evidence is too thin to act on",
      ]);
    });

    it("catches evidence citing a path that no longer resolves", () => {
      const mutant = mutate("P03", {
        scenarioId: "P03",
        kind: "not_applicable",
        rationale: `Nothing stores it; see src/lib/loops/transitions/planning.ts for the stage. ${padding}`,
      });

      expect(runGate("writtenEvidenceIsSubstantiveAndResolvable", mutant)).toEqual([
        "P03 cites missing src/lib/loops/transitions/planning.ts",
      ]);
    });

    it("catches a blocked scenario relabelled inapplicable", () => {
      const mutant = mutate("A02", {
        scenarioId: "A02",
        kind: "not_applicable",
        rationale: `The approvals surface will never be browser work. ${padding}`,
      });

      expect(runGate("kindAgreesWithTheMatrix", mutant)).toEqual([
        "A02 is not_applicable, against its matrix coverage column",
      ]);
    });

    it("catches a deferral the persona matrix does not note", () => {
      const mutant = mutate("P01", {
        scenarioId: "P01",
        kind: "deferred",
        reason: `Route walking is blocked on a surface that does not exist. ${padding}`,
        trackedBy: "#266",
      });

      expect(runGate("matrixDeferralSectionMatchesRegistry", mutant)).toEqual([
        "P01 is deferred, unnoted",
      ]);
    });

    it("catches a scenario the matrix defers that the registry no longer does", () => {
      const mutant = mutate("S05", {
        scenarioId: "S05",
        kind: "browser_journey",
        journeyIds: ["denied-sign-in-copy"],
      });

      expect(runGate("matrixDeferralSectionMatchesRegistry", mutant)).toEqual([
        "the matrix defers S05, unlisted",
      ]);
      // No journey claims S05, so the mutant is deliberately invalid twice.
      // Pinning the second violation stops this passing for an unrelated break.
      expect(runGate("journeysResolveAndClaimBack", mutant)).toEqual([
        "denied-sign-in-copy does not claim S05 back",
      ]);
    });

    it("catches a non-browser scenario relabelled deferred", () => {
      const mutant = mutate("P03", {
        scenarioId: "P03",
        kind: "deferred",
        reason: `Waiting on a surface the matrix never asked for. ${padding}`,
        trackedBy: "#266",
      });

      expect(runGate("kindAgreesWithTheMatrix", mutant)).toEqual([
        "P03 is deferred, against its matrix coverage column",
      ]);
    });
  });

  it("demonstrates every registered gate failing on at least one mutation", () => {
    // Runs last in file order, after the mutation cases have recorded. Order-
    // and completeness-dependent by construction: running this file with `-t`,
    // `.only`, or a shard fails it for reasons unrelated to the code.
    expect([...exercised].sort()).toEqual(Object.keys(gates).sort());
  });

  describe("the annotation matcher accepts comments and only comments", () => {
    // Uses A01 deliberately: M03 is the id the mutant test points at this
    // file, so writing it in comment position here would annotate the file
    // and break that test.
    //
    // Both directions of one convention. The loose form counted a URL-bearing
    // string literal as an annotation, which is how a spec with none could
    // satisfy the floor test below.
    it.each([
      ["// Persona A01: leading line comment", true],
      ["  // Persona A01: indented", true],
      [" * Persona P05/M04/M05: jsdoc continuation", true],
      ["/* Persona A01 */", true],
      ['it("x", () => {}); // Persona A01', true],
      ['expect(body).toContain("https://github.com/o/r/pull/1 Persona A01");', false],
      ['await expect(l).toHaveAttribute("href", "https://vercel.com/x/Persona A01");', false],
      ['const s = "Persona A01";', false],
      ['"tests/unit/loops/manifest.test.ts does not annotate Persona A01",', false],
      ['<a href="//cdn">Persona P02</a>', false],
    ])("%s", (line, annotated) => {
      expect(personaAnnotationsIn(line).size > 0).toBe(annotated);
    });

    it("still reads a real comment that happens to contain a URL", () => {
      expect([...personaAnnotationsIn("// Persona A01: see https://vercel.com/docs")]).toEqual([
        "A01",
      ]);
    });
  });

  describe("the matrix section parser bounds itself correctly", () => {
    // Filesystem-shaped, so unreachable through the registry `mutate()` harness
    // every other negative case uses.
    const section = (body: string) => `### Deferred Browser Coverage\n${body}`;

    it("stops at a heading of any level, not only h3", () => {
      for (const following of ["# Top", "## Parent", "#### Sub", "###### Deep"]) {
        expect(
          deferralSectionFrom(`${section("A02 is deferred.\n\n")}${following}\n\nR01 is not.\n`),
          following,
        ).not.toContain("R01");
      }
    });

    it("reads to the end of the document when no heading follows", () => {
      expect(deferralSectionFrom(section("A02 is deferred.\n"))).toContain("A02");
    });

    it("does not let a fenced code block end the section", () => {
      const fenced = [
        "### Deferred Browser Coverage",
        "A02 is deferred.",
        "```sh",
        "# run this",
        "```",
        "S05 is deferred too.",
        "### Next",
      ].join("\n");

      expect(deferralSectionFrom(fenced)).toContain("S05");
    });

    it("reports a missing section through the gate, not just the parser", () => {
      // The gate's early return was the last branch no mutant could reach,
      // because it depends on the document rather than the registry.
      const gate = matrixDeferralSectionMatchesRegistryUsing(() => undefined);

      expect(gate(personaJourneyRegistry)).toEqual([
        "the persona matrix has no Deferred Browser Coverage section",
      ]);
    });

    it("reports an absent section rather than an empty one", () => {
      expect(deferralSectionFrom("# Personas\n\nNo deferrals here.\n")).toBeUndefined();
    });
  });

  describe("the schema rejects malformed classifications outright", () => {
    it("rejects a scenario classified twice", () => {
      expect(personaJourneyRegistry.coverage.length).toBeGreaterThan(0);
      const [first] = personaJourneyRegistry.coverage;

      expect(withCoverage([...personaJourneyRegistry.coverage, first]).success).toBe(false);
    });

    it("rejects an entry that mixes two kinds' evidence", () => {
      const mixed = withCoverage([
        {
          scenarioId: "P01",
          kind: "browser_journey",
          journeyIds: ["operator-route-walk"],
          coveringTests: ["tests/unit/loops/manifest.test.ts"],
        },
      ]);

      expect(mixed.success).toBe(false);
    });

    it("rejects evidence that is present but empty", () => {
      for (const empty of [
        { scenarioId: "P01", kind: "browser_journey", journeyIds: [] },
        { scenarioId: "M03", kind: "deterministic_non_browser", coveringTests: [] },
        { scenarioId: "P03", kind: "not_applicable", rationale: "   " },
        { scenarioId: "A02", kind: "deferred", reason: "   ", trackedBy: "#266" },
        { scenarioId: "A02", kind: "deferred", reason: "Blocked.", trackedBy: "266" },
        { scenarioId: "A02", kind: "deferred", reason: "Blocked.", trackedBy: "#0" },
      ]) {
        expect(withCoverage([empty]).success, JSON.stringify(empty)).toBe(false);
      }
    });
  });
});
