import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { scannerRegistry } from "../../../scripts/run-security-scanner";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
};

type Workflow = {
  jobs: Record<string, { steps: WorkflowStep[] }>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const workflowSource = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const workflow = parse(workflowSource) as Workflow;

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const chainedCommands = (script: string) =>
  script
    .split("&&")
    .map((command) => command.trim())
    .filter((command) => command.length > 0);

const validateGates = chainedCommands(packageJson.scripts.validate ?? "");
const validateSteps = workflow.jobs.validate?.steps ?? [];
const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps);

/** The scanner set is read off the registry so this file cannot drift from it. */
const validateLaneScanners = scannerRegistry.filter((scanner) => scanner.lane === "validate");
const ciOnlyScanners = scannerRegistry.filter((scanner) => scanner.lane === "ci-only");

/**
 * Every scanner step is unconditional and fails the job, including the advisory
 * one. Advisory is a property of the *finding*, decided inside the runner and
 * covered by `run-security-scanner.test.ts`; the workflow never gets to make
 * that call, because `continue-on-error` would also swallow a scanner crash.
 */
function expectUnconditionalStep(gate: string) {
  const step = validateSteps.find((candidate) => candidate.run === gate);
  expect(step, `the validate job does not run \`${gate}\``).toBeDefined();
  expect(step?.["continue-on-error"], `\`${gate}\` is non-blocking`).toBeUndefined();
  expect(step?.if, `\`${gate}\` is conditional`).toBeUndefined();
}

describe("security scanning gates", () => {
  it.each(
    scannerRegistry.map((scanner) => [scanner.script, scanner] as const),
  )("defines a repository-owned command for `%s`", (script, scanner) => {
    const definition = packageJson.scripts[script];
    expect(definition, `package.json has no \`${script}\` script`).toBeDefined();
    expect(definition).toContain(scanner.id);
  });

  it.each(
    validateLaneScanners.map((scanner) => [scanner.script] as const),
  )("runs `%s` from both the local chain and CI", (script) => {
    const gate = `bun run ${script}`;
    // The local chain and the CI job must reach the same command. The
    // byte-identical string is what `ci-workflow.test.ts` keys on too.
    expect(validateGates, `\`bun run validate\` does not reach \`${script}\``).toContain(gate);
    expectUnconditionalStep(gate);
  });

  it.each(
    ciOnlyScanners.map((scanner) => [scanner.script] as const),
  )("runs `%s` as a CI-only gate", (script) => {
    const gate = `bun run ${script}`;
    // Deliberately outside `validate`: it is the documented local/CI
    // divergence, so it must be absent locally and unconditional in CI.
    expect(validateGates, `\`${script}\` is documented as CI-only`).not.toContain(gate);
    expectUnconditionalStep(gate);
  });

  it("keeps the aggregate scan covering exactly the validate-lane scanners", () => {
    const aggregate = packageJson.scripts["security:scan"];
    expect(aggregate, "package.json has no `security:scan` aggregate").toBeDefined();
    expect(chainedCommands(aggregate).sort()).toEqual(
      validateLaneScanners.map((scanner) => `bun run ${scanner.script}`).sort(),
    );
  });

  it("runs the scanners before the slow gates", () => {
    // A secret or a known-vulnerable dependency should fail in seconds rather
    // than after the Storybook build and the Playwright suite have run.
    const firstScanner = Math.min(
      ...validateLaneScanners.map((scanner) => validateGates.indexOf(`bun run ${scanner.script}`)),
    );
    for (const slowGate of ["bun run storybook:build", "bun run test:e2e"]) {
      expect(validateGates.indexOf(slowGate)).toBeGreaterThan(firstScanner);
    }
  });

  it("never marks any workflow step non-blocking", () => {
    // Asserted across the whole file, not just the security steps: the cheapest
    // way to disable a gate is to add `continue-on-error` to it.
    const escaped = allSteps.filter((step) => step["continue-on-error"] !== undefined);
    expect(escaped.map((step) => step.name ?? step.run ?? step.uses)).toEqual([]);
  });
});

describe("scanner installation", () => {
  it.each(
    scannerRegistry.map((scanner) => [scanner.id, scanner] as const),
  )("installs `%s` at the pinned version", (id, scanner) => {
    // The gate is only as trustworthy as the analyzer CI actually installed.
    // An unpinned install would silently drift away from the local pin.
    const installs = validateSteps.some((step) => step.run?.includes(scanner.version) === true);
    expect(installs, `the validate job does not install \`${id}\` at ${scanner.version}`).toBe(
      true,
    );
  });

  it("verifies the integrity of every downloaded artifact", () => {
    const downloads = allSteps.filter((step) => /\b(curl|wget)\b/.test(step.run ?? ""));
    expect(downloads.length, "no scanner download step found to verify").toBeGreaterThan(0);
    for (const step of downloads) {
      // A download without a publisher checksum check is an unauthenticated
      // binary running with repository access.
      expect(
        /sha256sum -c|shasum -a 256 -c/.test(step.run ?? ""),
        `\`${step.name ?? step.run}\` downloads without verifying a checksum`,
      ).toBe(true);
    }
  });
});

/**
 * Baseline hygiene for the two TOML baselines, checked as text rather than
 * through two config parsers. Every suppression has to name what it suppresses
 * and why, so a finding can never be silenced by widening a pattern. Semgrep's
 * ruleset is excluded deliberately: its `id:` keys name rules rather than
 * suppressions, so the same shape would flag every rule we add.
 */
const suppressionPattern = /^\s*(id|paths?|regexes?|commits?|stopwords|fingerprints?)\s*=/;
const broadPattern = /=\s*\[?\s*["'](\.\*|\.\+|\*\*?|)["']/;

function unjustifiedSuppressions(content: string): string[] {
  const lines = content.split("\n");
  return lines.flatMap((line, index) => {
    if (!suppressionPattern.test(line)) return [];
    const preceding = lines.slice(0, index).reverse();
    const justification = preceding.find((candidate) => candidate.trim().length > 0);
    const justified =
      justification?.trim().startsWith("#") === true || /reason|description/.test(line);
    return justified && !broadPattern.test(line) ? [] : [`line ${index + 1}: ${line.trim()}`];
  });
}

describe("baseline hygiene", () => {
  it("flags a broad or unexplained suppression", () => {
    // Control cases, so the assertions over the real configs below cannot pass
    // merely because the helper never reports anything.
    expect(unjustifiedSuppressions('id = "GHSA-xxxx-yyyy-zzzz"\n')).toHaveLength(1);
    expect(
      unjustifiedSuppressions('# expires 2026-12-01: upstream fix pending\npaths = [".*"]\n'),
    ).toHaveLength(1);
    expect(
      unjustifiedSuppressions('# expires 2026-12-01: upstream fix pending\nid = "GHSA-a-b-c"\n'),
    ).toHaveLength(0);
  });

  it.each([
    ".gitleaks.toml",
    "osv-scanner.toml",
  ])("keeps %s free of broad or unexplained suppressions", (relativePath) => {
    const content = readFileSync(path.join(repoRoot, relativePath), "utf8");
    expect(unjustifiedSuppressions(content)).toEqual([]);
  });
});
