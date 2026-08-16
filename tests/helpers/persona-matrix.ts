import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * One reader for the persona matrix, shared by every gate that consults it.
 *
 * Three suites previously parsed `docs/personas-and-test-scenarios.md`
 * independently. Parsers that disagree do not fail — the weakest one simply
 * decides, and nothing reports that the others were overruled.
 */
export const repoRoot = path.resolve(__dirname, "../..");

export type PersonaMatrixRow = { id: string; coverage: string };

/**
 * Matrix rows parsed by column.
 *
 * Reading the whole row would let prose anywhere in a scenario description
 * ("previously covered by a Playwright spec") silently reclassify it.
 */
export function personaMatrixRows(): PersonaMatrixRow[] {
  const matrix = readFileSync(path.join(repoRoot, "docs/personas-and-test-scenarios.md"), "utf8");

  return Array.from(matrix.matchAll(/^\| ([PMARS]\d{2}) \|(.+)\|\s*$/gm)).map(([, id, rest]) => {
    const cells = (rest ?? "").split("|");
    return { id: id as string, coverage: cells[cells.length - 1]?.trim() ?? "" };
  });
}

/**
 * Scenario ids in document order, including any duplicates the doc contains.
 *
 * Derived from `personaMatrixRows` rather than re-matching the file with a
 * looser pattern. Two patterns over one document is the failure this module
 * exists to remove: a row missing its trailing pipe would be counted here and
 * dropped there, and the parity gate would stay green while every
 * coverage-column gate quietly stopped seeing it.
 */
export function documentedPersonaTestIds(): string[] {
  return personaMatrixRows().map((row) => row.id);
}

/** Scenario ids whose Primary Coverage column names Playwright. */
export function browserApplicableScenarioIds(): string[] {
  return personaMatrixRows()
    .filter((row) => /playwright/i.test(row.coverage))
    .map((row) => row.id);
}

/**
 * A persona annotation: `Persona A01/A03/R01` inside a comment.
 *
 * One pattern for both directions. Two parsers over one convention disagreed at
 * the edges — a block comment counted as a claim but not as coverage evidence,
 * and a bare mention in a locator or a test title counted as a claim with no
 * annotation present at all — which is the divergence this module exists to
 * remove. Comment forms accepted: `//`, a JSDoc continuation `*`, and `/*`,
 * each either opening a line or following code after whitespace.
 *
 * The opener must be anchored that way. Matching a bare `//` anywhere
 * reopened the hole this pattern closes: any line carrying a URL — and this
 * repository's assertions are full of `https://github.com/…` — supplies the
 * `//` while the scenario id sits in a plain string literal.
 */
// Built per call: a shared `/g` regex carries `lastIndex`, so one `.test()`
// by a future caller would make the next scan skip annotations. Every gate
// here fails by omission, the direction that does not fail closed.
const personaAnnotationPattern = () =>
  /(?:^[ \t]*(?:\/\/|\/\*+|\*)|[ \t]+(?:\/\/|\/\*+))[^\n]*?\bPersona ((?:[PMARS]\d{2})(?:\/[PMARS]\d{2})*)/gm;

/** Relative paths of every browser spec (`.spec.ts` or `.spec.tsx`), nested included. */
export function e2eSpecPaths(): string[] {
  // Recursive because #243 may generate specs into subdirectories, and a spec
  // this never lists is a spec no gate below can see.
  const walk = (dir: string): string[] =>
    readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : /\.spec\.tsx?$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    );

  return walk("tests/e2e");
}

/**
 * Scenario ids each existing browser spec annotates, keyed by scenario.
 *
 * The specs under `tests/e2e/` carry `Persona A01/A03/R01: …` comments above the
 * tests they belong to. That convention is the only machine-readable link
 * between a scenario and a spec that already exercises it, and it is what lets a
 * classification be checked against browser coverage that predates the registry.
 *
 * The convention is not self-enforcing: a spec that phrases its annotation
 * differently is invisible here, which is how `sign-in.spec.ts` ("personas P06
 * and S07") and `day-zero-activation.spec.ts` once hid four scenarios from it.
 * `specsWithoutPersonaClaims` is the floor against a new spec doing the same;
 * dropping one annotation from a spec that still has others stays undetectable.
 */
export function personaAnnotationsIn(source: string): Set<string> {
  const ids = new Set<string>();

  for (const [, group] of source.matchAll(personaAnnotationPattern())) {
    for (const id of (group as string).split("/")) ids.add(id);
  }

  return ids;
}

export function e2ePersonaClaims(): Map<string, string[]> {
  const claims = new Map<string, string[]>();

  for (const relative of e2eSpecPaths()) {
    for (const id of personaAnnotationsIn(readFileSync(path.join(repoRoot, relative), "utf8"))) {
      claims.set(id, [...new Set([...(claims.get(id) ?? []), relative])]);
    }
  }

  return claims;
}

/** Browser specs that annotate no persona at all. */
export function specsWithoutPersonaClaims(): string[] {
  const claimed = new Set([...e2ePersonaClaims().values()].flat());

  return e2eSpecPaths().filter((relative) => !claimed.has(relative));
}

/**
 * The deferral section of a persona matrix document.
 *
 * Terminates on a heading of any level, not just `###`: bounding it to `##`/`###`
 * meant an h4 subsection was read as part of the section and an h1 never closed
 * it, so ids belonging to neither were collected as deferred.
 *
 * Takes the markdown so it can be exercised against synthetic documents; the
 * filesystem read is `deferralSection` below.
 */
export function deferralSectionFrom(markdown: string): string | undefined {
  // Blank fenced blocks first, preserving line structure. Widening the
  // terminator to any heading level made `#` significant, and `#` opens a
  // comment in most shells — so a snippet inside the section would end it early
  // and report every deferral below the fence as unnoted.
  const withoutFences = markdown.replace(/^```[\s\S]*?^```/gm, (block) =>
    block.replace(/[^\n]/g, " "),
  );

  return withoutFences.match(
    /^### Deferred Browser Coverage$([\s\S]*?)(?=^#{1,6} |\s*$(?![\s\S]))/m,
  )?.[1];
}

/** The deferral section of the persona matrix on disk. */
export function deferralSection(): string | undefined {
  return deferralSectionFrom(
    readFileSync(path.join(repoRoot, "docs/personas-and-test-scenarios.md"), "utf8"),
  );
}
