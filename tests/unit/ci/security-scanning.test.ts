import { execFileSync } from "node:child_process";
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

describe("scanner rulesets", () => {
  it("keeps the curated Semgrep ruleset non-empty and severity-carrying", () => {
    // `semgrep --error` exits 0 against a ruleset with no rules, so emptying
    // this file disables the SAST gate without touching a single command,
    // workflow step, or registry entry.
    const ruleset = parse(readFileSync(path.join(repoRoot, ".semgrep/loopworks.yml"), "utf8")) as {
      rules?: { id?: string; severity?: string; message?: string }[];
    };
    const rules = ruleset.rules ?? [];
    expect(rules.length, "the curated ruleset has no rules").toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.id, "a rule has no id").toBeTruthy();
      // Only ERROR findings make `--error` exit non-zero; a rule downgraded to
      // WARNING is present in the output and absent from the gate.
      expect(rule.severity, `rule \`${rule.id}\` is not ERROR severity`).toBe("ERROR");
      expect(rule.message, `rule \`${rule.id}\` has no message`).toBeTruthy();
    }
  });

  it("keeps Gitleaks on the maintained upstream ruleset", () => {
    // Without `useDefault` the config carries no detectors at all and every
    // scan is clean.
    const config = readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
    expect(config).toMatch(/useDefault\s*=\s*true/);
  });

  it("scans the test tree with Semgrep", () => {
    // Semgrep's bundled default ignore list excludes `tests/`, which silently
    // took 119 files out of scope. Declaring `.semgrepignore` replaces that
    // default, so this asserts the replacement has not re-excluded them.
    const ignore = readFileSync(path.join(repoRoot, ".semgrepignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(ignore).not.toContain("tests/");
    expect(ignore).not.toContain("tests");
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
const suppressionKey = /^\s*(id|paths?|regexes?|commits?|stopwords|fingerprints?)\s*=/;

/**
 * A pattern that matches everything, or nearly everything. `'''.*'''` inside a
 * `regexes` array silences Gitleaks completely, which is the single cheapest
 * way to turn this gate off.
 */
const broadValue = /^(\.\*|\.\+|\*\*?|\.\*\??|\(\.\*\)|\^?\.\*\$?|\^\(\?:\.\*\)\$?|)$/;

/** Strips TOML string quoting: `'''x'''`, `"""x"""`, `'x'`, `"x"`. */
function unquote(raw: string): string | undefined {
  const value = raw.trim().replace(/,$/, "").trim();
  const match = /^('''|"""|'|")([\s\S]*)\1$/.exec(value);
  return match?.[2];
}

/**
 * Reports suppressions that are broad or unexplained. Crucially this walks
 * *array elements*, not only the lines that open a key: in the real
 * `.gitleaks.toml` every actual suppression lives inside a multi-line
 * `regexes = [...]` or `paths = [...]` array, so a checker that only looked at
 * the opening line would inspect none of them and pass while the gate was wide
 * open.
 */
function unjustifiedSuppressions(content: string): string[] {
  const lines = content.split("\n");
  const problems: string[] = [];
  let inArray = false;
  let arrayJustified = false;

  const commentedAbove = (index: number) =>
    lines
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.trim().length > 0)
      ?.trim()
      .startsWith("#") === true;

  lines.forEach((line, index) => {
    const report = () => problems.push(`line ${index + 1}: ${line.trim()}`);
    const trimmed = line.trim();

    if (inArray) {
      if (trimmed.startsWith("]")) {
        inArray = false;
        return;
      }
      // A comment directly above an element justifies that element; otherwise
      // the comment above the array as a whole carries it.
      if (trimmed.length === 0 || trimmed.startsWith("#")) return;
      const value = unquote(trimmed);
      if (
        value === undefined ||
        broadValue.test(value) ||
        (!arrayJustified && !commentedAbove(index))
      ) {
        report();
      }
      return;
    }

    if (!suppressionKey.test(line)) return;

    const justified = commentedAbove(index) || /reason|description/.test(line);

    if (/=\s*\[\s*$/.test(line)) {
      inArray = true;
      arrayJustified = justified;
      return;
    }

    const value = unquote(line.slice(line.indexOf("=") + 1));
    if (!justified || value === undefined || broadValue.test(value)) report();
  });

  return problems;
}

describe("baseline hygiene", () => {
  it("flags an unexplained single-line suppression", () => {
    expect(unjustifiedSuppressions('id = "GHSA-xxxx-yyyy-zzzz"\n')).toHaveLength(1);
    expect(
      unjustifiedSuppressions('# expires 2026-12-01: upstream fix pending\nid = "GHSA-a-b-c"\n'),
    ).toHaveLength(0);
  });

  it.each([
    ".*",
    ".+",
    "*",
    "",
    "^.*$",
  ])("flags %j as a catch-all however it is justified", (pattern) => {
    // Justification does not launder a pattern that silences the scanner.
    expect(unjustifiedSuppressions(`# reviewed\npaths = [\n  '''${pattern}''',\n]\n`)).toHaveLength(
      1,
    );
  });

  it("walks array elements, not just the line that opens the array", () => {
    // The case the first version of this helper missed entirely, and the shape
    // every real suppression in .gitleaks.toml takes. Appending one catch-all
    // to the array disables Gitleaks completely.
    const widened = [
      "# scope, not suppression",
      "paths = [",
      "  '''^node_modules/''',",
      "  '''.*''',",
      "]",
    ].join("\n");
    expect(unjustifiedSuppressions(widened)).toHaveLength(1);
  });

  it("accepts an explained array of exact patterns", () => {
    const sound = ["# reviewed: build output only", "paths = [", "  '''^coverage/''',", "]"].join(
      "\n",
    );
    expect(unjustifiedSuppressions(sound)).toHaveLength(0);
  });

  it.each([
    ".gitleaks.toml",
    "osv-scanner.toml",
  ])("keeps %s free of broad or unexplained suppressions", (relativePath) => {
    const content = readFileSync(path.join(repoRoot, relativePath), "utf8");
    expect(unjustifiedSuppressions(content)).toEqual([]);
  });

  it("keeps every .gitleaksignore fingerprint exact and explained", () => {
    // A separate suppression file with its own format, previously covered by
    // nothing at all. Entries are `sha:path:rule:line`; anything shorter is a
    // prefix that can match more findings than the one that was reviewed.
    const lines = readFileSync(path.join(repoRoot, ".gitleaksignore"), "utf8").split("\n");
    const entries = lines
      .map((line, index) => ({ index, value: line.trim() }))
      .filter((entry) => entry.value.length > 0 && !entry.value.startsWith("#"));

    for (const entry of entries) {
      expect(entry.value, `${entry.value} is not a four-part fingerprint`).toMatch(
        /^[0-9a-f]{40}:[^:]+:[^:]+:\d+$/,
      );
      const preceding = lines
        .slice(0, entry.index)
        .reverse()
        .find((candidate) => candidate.trim().length > 0);
      expect(preceding?.trim().startsWith("#"), `${entry.value} has no justification`).toBe(true);
    }
  });

  it("keeps scanner path exclusions off tracked files", () => {
    // Gitleaks applies `[allowlist] paths` in `git` mode too, so an exclusion
    // hides a path from the history gate as well as the working-tree gate. An
    // entry that starts matching tracked files is a real blind spot, not a
    // scoping choice — `bun.lock` and `.claude/` were both exactly that.
    const config = readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
    const block = /paths\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
    const patterns = block
      .split("\n")
      .map((line) => unquote(line))
      .filter((value): value is string => value !== undefined);
    expect(patterns.length, "no path exclusions found to check").toBeGreaterThan(0);

    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
      .split("\n")
      .filter((line) => line.length > 0);

    for (const pattern of patterns) {
      const matches = tracked.filter((file) => new RegExp(pattern).test(file));
      expect(matches.slice(0, 5), `exclusion \`${pattern}\` hides tracked files`).toEqual([]);
    }
  });
});
