/** @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";

const transitionsDirectory = "src/lib/loops/transitions";
const legacyModule = "src/lib/loops/development-run-transitions.ts";
const expectedModules = [
  "plan",
  "test-writing",
  "implementation",
  "validation",
  "pr-preparation",
  "validation-review",
  "pr-stage",
  "finalization",
  "shared",
  "index",
] as const;

const stageOwners = {
  "finalization.ts": [
    "finalizeDevelopmentLoopRun",
    "completeDevelopmentLoopRun",
    "scheduleDevelopmentLoopStageRetry",
    "retryDevelopmentLoopStep",
  ],
  "implementation.ts": ["applyDevelopmentLoopImplementationResult"],
  "plan.ts": ["recordDevelopmentLoopPlanArtifact"],
  "pr-preparation.ts": ["applyDevelopmentLoopPrPreparationResult"],
  "pr-stage.ts": ["executeDevelopmentLoopPrStage"],
  "test-writing.ts": ["applyDevelopmentLoopTestWritingResult"],
  "validation-review.ts": ["applyDevelopmentLoopValidationReviewResult"],
  "validation.ts": ["applyDevelopmentLoopValidationReport"],
} as const;

describe("development-loop transition module layout", () => {
  it("provides scoped agent context for loops and transition ownership", () => {
    const loopGuidePath = "src/lib/loops/AGENTS.md";
    const transitionGuidePath = `${transitionsDirectory}/AGENTS.md`;
    const missingGuides = [loopGuidePath, transitionGuidePath].filter((path) => !existsSync(path));

    expect(missingGuides).toEqual([]);
    if (missingGuides.length > 0) return;

    const loopGuide = readFileSync(loopGuidePath, "utf8");
    const transitionGuide = readFileSync(transitionGuidePath, "utf8");
    expect(loopGuide).toContain("transitions/AGENTS.md");
    expect(loopGuide).toContain("ADRs 0014 through 0017");
    expect(transitionGuide).toContain("Stage Ownership");
    expect(transitionGuide).toContain("Production callers import from `@/lib/loops/transitions`");
    expect(transitionGuide).toContain("`shared.ts` must not import stage modules or `index.ts`");
  });

  it("contains every stage-owned module and removes the legacy monolith", () => {
    const missingModules = expectedModules.filter(
      (moduleName) => !existsSync(`${transitionsDirectory}/${moduleName}.ts`),
    );

    expect(missingModules).toEqual([]);
    expect(existsSync(legacyModule)).toBe(false);
  });

  it("keeps each public transition implementation in exactly one owning stage", () => {
    const existingSources = expectedModules.flatMap((moduleName) => {
      const path = `${transitionsDirectory}/${moduleName}.ts`;
      return existsSync(path) ? [{ path, source: readFileSync(path, "utf8") }] : [];
    });

    for (const [ownerFile, functions] of Object.entries(stageOwners)) {
      for (const functionName of functions) {
        const implementationPattern = new RegExp(
          `export\\s+async\\s+function\\s+${functionName}\\s*\\(`,
        );
        const implementationFiles = existingSources
          .filter(({ source }) => implementationPattern.test(source))
          .map(({ path }) => path);

        expect(implementationFiles).toEqual([`${transitionsDirectory}/${ownerFile}`]);
      }
    }
  });

  it("keeps shared leaf-like and the barrel explicit", () => {
    const sharedPath = `${transitionsDirectory}/shared.ts`;
    const indexPath = `${transitionsDirectory}/index.ts`;
    if (!existsSync(sharedPath) || !existsSync(indexPath)) {
      expect([sharedPath, indexPath].filter((path) => !existsSync(path))).toEqual([]);
      return;
    }

    const sharedSource = readFileSync(sharedPath, "utf8");
    const indexSource = readFileSync(indexPath, "utf8");
    const stageImportPattern =
      /from\s+["']\.\/(?:index|plan|test-writing|implementation|validation|pr-preparation|validation-review|pr-stage|finalization)["']/;

    expect(sharedSource).not.toMatch(stageImportPattern);
    expect(indexSource).not.toMatch(/export\s+\*/);
  });

  it("keeps retry-reason normalization owned by finalization", () => {
    const validationSource = readFileSync(`${transitionsDirectory}/validation.ts`, "utf8");
    const finalizationSource = readFileSync(`${transitionsDirectory}/finalization.ts`, "utf8");

    expect(validationSource).not.toMatch(/safeReasonCodePattern|normalizeReasonCode/);
    expect(finalizationSource).toMatch(/safeReasonCodePattern/);
    expect(finalizationSource).toMatch(/normalizeReasonCode/);
  });
});
