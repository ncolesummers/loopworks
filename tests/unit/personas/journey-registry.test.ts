/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { githubInstallationOutcomes } from "@/components/portal/github-installation-outcome";
import { signInErrorNotices } from "@/lib/auth/sign-in-errors";
import { researchLoopStages } from "@/lib/loops/research-run";
import { personaJourneyRegistry } from "@/lib/personas/journey-registry";
import { personaTestIdValues } from "../../../schemas/loop-manifest";
import {
  journeyCleanupForMutations,
  personaRolesForScenarioIds,
} from "../../../schemas/persona-journey";

const repoRoot = path.resolve(__dirname, "../../..");
const registryPath = "src/lib/personas/journey-registry.ts";

/**
 * Rows of the persona matrix, parsed by column.
 *
 * Reading the whole row would let prose anywhere in a scenario description
 * ("previously covered by a Playwright spec") silently reclassify it.
 */
function matrixRows(): Array<{ id: string; coverage: string }> {
  const matrix = readFileSync(path.join(repoRoot, "docs/personas-and-test-scenarios.md"), "utf8");

  return Array.from(matrix.matchAll(/^\| ([PMARS]\d{2}) \|(.+)\|\s*$/gm)).map(([, id, rest]) => {
    const cells = (rest ?? "").split("|");
    return { id: id as string, coverage: cells[cells.length - 1]?.trim() ?? "" };
  });
}

function browserApplicableFromMatrix(): string[] {
  const rows = matrixRows();

  // Total parse failure is not the interesting case. One padded cell silently
  // drops a single row, which would quietly narrow AC5 — so the row count is
  // pinned to the ID vocabulary instead of merely being non-zero.
  expect(rows.length, "persona matrix rows did not parse one-to-one with the ID vocabulary").toBe(
    personaTestIdValues.length,
  );

  return rows.filter((row) => /playwright/i.test(row.coverage)).map((row) => row.id);
}

/**
 * Scenarios deliberately excluded because the product surface they describe
 * does not exist yet. Each is justified in the registry module's header.
 */
const deferredScenarios = ["A02", "A03", "R02", "S05", "M02"];

/** Product source, excluding stories and the registry itself. */
function productSource(): string {
  const chunks: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const relative = path.relative(repoRoot, full);
      if (relative === registryPath) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      // Stories are not the product, and a story-only string should not count
      // as grounding. `tests/e2e` is excluded too: #243 generates specs from
      // this registry, so including them would restore the circularity one
      // issue later.
      if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith(".stories.tsx")) continue;
      chunks.push(readFileSync(full, "utf8"));
    }
  };

  walk(path.join(repoRoot, "src"));
  return chunks.join("\n");
}

/**
 * Quoted product strings, e.g. `'Repo catalog'`.
 *
 * Requires a boundary before the opening quote and after the closing one, so a
 * possessive apostrophe elsewhere in the sentence cannot pair with a real quote
 * and yield a garbage phrase.
 */
function quotedPhrases(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|[\s(])'([^']{2,})'(?=$|[\s.,;:)])/g)).map(
    ([, phrase]) => phrase as string,
  );
}

let sourceCorpus = "";

beforeAll(() => {
  sourceCorpus = productSource();
  // The registry must not ground itself. Asserted by path, not by a substring
  // that a sibling module could legitimately contain.
  expect(sourceCorpus).not.toContain("The executable projection of");
  expect(sourceCorpus.length).toBeGreaterThan(100_000);
});

describe("persona journey registry", () => {
  it("declares a journey for every browser-applicable scenario it does not defer", () => {
    // AC5, checked against the matrix itself rather than a private copy.
    const browserApplicable = browserApplicableFromMatrix();
    const declared = new Set<string>(
      personaJourneyRegistry.journeys.flatMap((journey) => journey.personaTestIds),
    );

    const expected = browserApplicable.filter((id) => !deferredScenarios.includes(id));
    expect(
      expected.filter((id) => !declared.has(id)),
      "browser scenario with no journey",
    ).toEqual([]);
    expect(deferredScenarios.filter((id) => !browserApplicable.includes(id))).toEqual([]);
  });

  it("declares no scenario the matrix does not mark browser-applicable", () => {
    const browserApplicable = new Set(browserApplicableFromMatrix());

    for (const journey of personaJourneyRegistry.journeys) {
      for (const id of journey.personaTestIds) {
        expect(browserApplicable.has(id), `${journey.journeyId} claims non-browser ${id}`).toBe(
          true,
        );
      }
    }
  });

  it("maps each scenario to exactly one journey", () => {
    const owners = new Map<string, string[]>();
    for (const journey of personaJourneyRegistry.journeys) {
      for (const id of journey.personaTestIds) {
        owners.set(id, [...(owners.get(id) ?? []), journey.journeyId]);
      }
    }

    for (const [id, journeyIds] of owners) {
      expect(journeyIds, `${id} is claimed by more than one journey`).toHaveLength(1);
    }
  });

  it("resolves every declared route to a real page, with a real query value", () => {
    // A route that exists is not enough: the query value carries the assertion
    // in three journeys, and both vocabularies are closed and exported.
    const installOutcomes = new Set<string>(githubInstallationOutcomes);
    const signInErrors = new Set(Object.keys(signInErrorNotices));

    for (const journey of personaJourneyRegistry.journeys) {
      for (const route of journey.allowedRoutes) {
        const [pathname = "", query = ""] = route.split("?");
        const segments = pathname
          .replace(/(.)\/$/, "$1")
          .split("/")
          .filter(Boolean);

        // Pages only. An API `route.ts` is not a browser destination.
        const resolved = ["", "(portal)"].some((group) =>
          [path.join(repoRoot, "src/app", group, ...segments, "page.tsx")].some((file) => {
            try {
              return statSync(file).isFile();
            } catch {
              return false;
            }
          }),
        );
        expect(resolved, `${journey.journeyId} declares unroutable ${route}`).toBe(true);

        for (const [key, value] of new URLSearchParams(query)) {
          if (key === "github") {
            expect(installOutcomes.has(value), `${route}: unknown install outcome`).toBe(true);
          }
          if (key === "error") {
            // The hostile-parameter case is deliberately not a real code.
            const known = signInErrors.has(value) || /[<>]/.test(value);
            expect(known, `${route}: unknown sign-in error code`).toBe(true);
          }
        }
      }
    }
  });

  it("binds every declared route to a surface the journey declares", () => {
    const surfaceByRoute: Record<string, string> = {
      "/": "dashboard",
      "/catalog": "catalog",
      "/loops": "loops",
      "/loops/register": "loop-registration",
      "/runs": "runs",
      "/approvals": "approvals",
      "/deployments": "deployments",
      "/settings": "settings",
      "/settings/repositories": "settings-repositories",
      "/sign-in": "sign-in",
    };

    for (const journey of personaJourneyRegistry.journeys) {
      for (const route of journey.allowedRoutes) {
        const base = route.split(/[?#]/)[0]?.replace(/(.)\/$/, "$1") ?? "";
        const surface = surfaceByRoute[base];

        expect(surface, `${journey.journeyId}: no surface mapped for ${route}`).toBeDefined();
        expect(
          journey.surfaces as readonly string[],
          `${journey.journeyId} navigates ${route} without declaring ${surface}`,
        ).toContain(surface);
      }
    }
  });

  it("finds every quoted product string in the source", () => {
    for (const journey of personaJourneyRegistry.journeys) {
      const described = [
        ...journey.checkpoints.map((checkpoint) => checkpoint.description),
        ...journey.actions.map((action) => action.description),
      ];

      for (const text of described) {
        for (const phrase of quotedPhrases(text)) {
          expect(
            sourceCorpus.includes(phrase),
            `${journey.journeyId} quotes "${phrase}", absent from src/`,
          ).toBe(true);
        }
      }
    }
  });

  it("grounds every journey in at least one quoted product string", () => {
    // Without this the gate rewards not quoting: a journey that names nothing
    // concrete is trivially "grounded".
    for (const journey of personaJourneyRegistry.journeys) {
      const phrases = [
        ...journey.checkpoints.map((checkpoint) => checkpoint.description),
        ...journey.actions.map((action) => action.description),
      ].flatMap(quotedPhrases);

      expect(phrases.length, `${journey.journeyId} quotes no product string`).toBeGreaterThan(0);
    }
  });

  it("states the research stage sequence in the order the product defines", () => {
    // The phrase gate proves each stage name exists; it cannot see order.
    // Reversing the sequence keeps every phrase valid, so the order is bound
    // to `researchLoopStages` directly.
    const journey = personaJourneyRegistry.journeys.find(
      (candidate) => candidate.journeyId === "run-detail-stage-sequence",
    );
    const ordering = journey?.checkpoints.find((checkpoint) => checkpoint.id === "stages-in-order");

    expect(ordering, "run-detail-stage-sequence has no stages-in-order checkpoint").toBeDefined();
    expect(quotedPhrases(ordering?.description ?? "")).toEqual(
      researchLoopStages.map((stage) => stage.title),
    );

    // Artifact labels live in the same objects and were order-free until now:
    // reversing them kept every phrase valid.
    const artifacts = journey?.checkpoints.find(
      (checkpoint) => checkpoint.id === "artifact-links-present",
    );
    expect(quotedPhrases(artifacts?.description ?? "")).toEqual(
      researchLoopStages.map((stage) => stage.artifact.label),
    );
  });

  it("keeps every declared surface reachable by some action", () => {
    for (const journey of personaJourneyRegistry.journeys) {
      const used = new Set(journey.actions.map((action) => action.surface));
      // `app-shell` is chrome: `src/app/(portal)/layout.tsx` wraps every portal
      // route in `PortalShell`, so it is rendered on surfaces no action targets
      // and is a genuine dependency for #244's expansion. Requiring an action
      // for it would under-select every journey on a shell regression, and for
      // a selection artifact under-selection is a bug while over-selection is
      // merely a cost.
      const unused = journey.surfaces.filter(
        (surface) => surface !== "app-shell" && !used.has(surface),
      );

      expect(unused, `${journey.journeyId} declares surfaces no action reaches`).toEqual([]);
    }
  });

  it("declares app-shell on every authenticated journey", () => {
    // The converse of the exemption above: the shell renders on every portal
    // route, so omitting it would silently narrow #244's expansion.
    for (const journey of personaJourneyRegistry.journeys) {
      if (journey.session.kind === "unauthenticated") continue;
      expect(journey.surfaces as readonly string[], journey.journeyId).toContain("app-shell");
    }
  });

  it("derives the cleanup obligation each journey actually incurs", () => {
    const expected: Record<string, string[]> = {
      "operator-route-walk": [],
      "theme-persistence": ["browser_storage_reset"],
      "day-zero-activation": ["fixture_database_reset"],
      "catalog-metadata-and-filters": [],
      "run-detail-stage-sequence": [],
      "pr-intent-linkage": [],
      "unauthenticated-orientation": [],
      "denied-sign-in-copy": [],
    };

    expect(Object.keys(expected).sort()).toEqual(
      personaJourneyRegistry.journeys.map((journey) => journey.journeyId).sort(),
    );
    for (const journey of personaJourneyRegistry.journeys) {
      expect(journeyCleanupForMutations(journey.mutations), `${journey.journeyId} cleanup`).toEqual(
        expected[journey.journeyId],
      );
    }
  });

  it("keeps every budget derived from the journey's own action count", () => {
    // The convention is otherwise unenforced, and an inflated budget makes the
    // schema's only budget refinement vacuous.
    for (const journey of personaJourneyRegistry.journeys) {
      expect(journey.budgets.maxActions, `${journey.journeyId} budget`).toBe(
        journey.actions.length + 2,
      );
    }
  });

  it("shares a fixture world only between journeys with the same start state", () => {
    // Derived, not a pair of hardcoded groups: any collapse of two different
    // start states into one world now fails.
    const byWorld = new Map<string, typeof personaJourneyRegistry.journeys>();
    for (const journey of personaJourneyRegistry.journeys) {
      byWorld.set(journey.fixtureWorldId, [
        ...(byWorld.get(journey.fixtureWorldId) ?? []),
        journey,
      ]);
    }

    for (const [world, journeys] of byWorld) {
      const startStates = new Set(journeys.map((journey) => journey.startState));
      expect(
        startStates.size,
        `${world} is shared by journeys with different start states: ${journeys
          .map((journey) => journey.journeyId)
          .join(", ")}`,
      ).toBe(1);
    }
  });

  it("binds each journey's session to the persona its scenarios derive", () => {
    // Keyed on the derived persona role rather than the journey id, so moving a
    // scenario to a journey with the wrong persona's session fails.
    const profileByRole: Record<string, string> = {
      product_operator: "operator-primary",
      maintainer: "maintainer-primary",
      agent_supervisor: "supervisor-primary",
      reviewer: "reviewer-primary",
      security_reviewer: "security-reviewer-primary",
    };
    const unauthenticated = new Set(["unauthenticated-orientation", "denied-sign-in-copy"]);

    for (const journey of personaJourneyRegistry.journeys) {
      const roles = personaRolesForScenarioIds(journey.personaTestIds);

      if (unauthenticated.has(journey.journeyId)) {
        expect(journey.session.kind, journey.journeyId).toBe("unauthenticated");
        continue;
      }

      // The day-zero walk legitimately spans product operator and maintainer,
      // so the profile must be one of the derived roles rather than the only
      // one. A profile belonging to a persona the scenarios never imply fails.
      const allowed = roles.map((role) => profileByRole[role]);
      expect(journey.session.kind, journey.journeyId).toBe("persona_fixture");
      expect(
        allowed,
        `${journey.journeyId} uses a session its personas (${roles.join(", ")}) do not imply`,
      ).toContain((journey.session as { sessionProfileId: string }).sessionProfileId);
    }
  });

  it("collapses the day-zero walk into one ordered journey", () => {
    const dayZero = personaJourneyRegistry.journeys.filter((journey) =>
      journey.personaTestIds.some((id) => ["P05", "M04", "M05"].includes(id)),
    );

    expect(dayZero).toHaveLength(1);
    expect([...(dayZero[0]?.personaTestIds ?? [])].sort()).toEqual(["M04", "M05", "P05"]);
  });

  it("keeps every deferred scenario out of the registry, justified, and noted in the matrix", () => {
    const declared = new Set<string>(
      personaJourneyRegistry.journeys.flatMap((journey) => journey.personaTestIds),
    );
    const module = readFileSync(path.join(repoRoot, registryPath), "utf8");
    const matrix = readFileSync(path.join(repoRoot, "docs/personas-and-test-scenarios.md"), "utf8");

    for (const id of deferredScenarios) {
      expect(personaTestIdValues as readonly string[]).toContain(id);
      expect(declared.has(id), `${id} is deferred but still declared`).toBe(false);

      // The reason must be a written list item, not the bare id typed into an
      // array. Length is a floor against " - X — n/a".
      const reason = module.match(
        new RegExp(`^ \\* - ${id} — ([\\s\\S]*?)(?=\\n \\* - |\\n \\*\\n)`, "m"),
      );
      expect(
        reason?.[1]?.trim().length ?? 0,
        `${id} has no written deferral reason`,
      ).toBeGreaterThan(80);

      // #241 requires the narrative and the registry not to drift, so the
      // matrix records the deferral too.
      expect(matrix, `${id} is deferred with no note in the persona matrix`).toMatch(
        new RegExp(`${id}[\\s\\S]{0,400}?deferred`, "i"),
      );
    }
  });
});
