import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
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

type WorkflowJob = {
  "continue-on-error"?: boolean;
  if?: string;
  steps: WorkflowStep[];
};

type Workflow = {
  jobs: Record<string, WorkflowJob>;
};

const repoRoot = path.resolve(__dirname, "../../..");
const workflowSource = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const workflow = parse(workflowSource) as Workflow;

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides?: Record<string, string>;
  scripts: Record<string, string>;
};
const securityReviewSource = readFileSync(path.join(repoRoot, "docs/security-review.md"), "utf8");

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
  it.each(scannerRegistry.map((scanner) => [scanner.script, scanner] as const))(
    "defines a repository-owned command for `%s`",
    (script, scanner) => {
      const definition = packageJson.scripts[script];
      expect(definition, `package.json has no \`${script}\` script`).toBeDefined();
      expect(definition).toContain(scanner.id);
    },
  );

  it.each(validateLaneScanners.map((scanner) => [scanner.script] as const))(
    "runs `%s` from both the local chain and CI",
    (script) => {
      const gate = `bun run ${script}`;
      // The local chain and the CI job must reach the same command. The
      // byte-identical string is what `ci-workflow.test.ts` keys on too.
      expect(validateGates, `\`bun run validate\` does not reach \`${script}\``).toContain(gate);
      expectUnconditionalStep(gate);
    },
  );

  it.each(ciOnlyScanners.map((scanner) => [scanner.script] as const))(
    "runs `%s` as a CI-only gate",
    (script) => {
      const gate = `bun run ${script}`;
      // Deliberately outside `validate`: it is the documented local/CI
      // divergence, so it must be absent locally and unconditional in CI.
      expect(validateGates, `\`${script}\` is documented as CI-only`).not.toContain(gate);
      expectUnconditionalStep(gate);
    },
  );

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

  it("never marks any workflow job non-blocking", () => {
    // The step-level check above misses the cheaper bypass by one level:
    // `continue-on-error` or `if` on the *job* disables every gate inside it at
    // once, and a step-only assertion passes while the whole scanner set is
    // advisory. Verified: adding `continue-on-error: true` to `jobs.validate`
    // left the entire CI contract suite green before this test existed.
    const escaped = Object.entries(workflow.jobs).filter(
      ([, job]) => job["continue-on-error"] !== undefined || job.if !== undefined,
    );
    expect(escaped.map(([name]) => name)).toEqual([]);
  });

  it("names the OSV workflow step as a blocking dependency gate", () => {
    const osv = validateSteps.find((step) => step.run === "bun run security:osv");
    expect(osv?.name).toBe("Dependency vulnerabilities");
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

  it("keeps generated Eve build output out of working-tree scans", () => {
    const gitleaks = readFileSync(path.join(repoRoot, ".gitleaks.toml"), "utf8");
    expect(gitleaks).toContain("'''^\\.eve/'''");
    expect(gitleaks).toContain("'''^\\.output/'''");

    const semgrep = readFileSync(path.join(repoRoot, ".semgrepignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    expect(semgrep).toContain(".eve/");
    expect(semgrep).toContain(".output/");
  });
});

describe("scanner installation", () => {
  it.each(scannerRegistry.map((scanner) => [scanner.id, scanner] as const))(
    "installs `%s` at the pinned version",
    (id, scanner) => {
      // The gate is only as trustworthy as the analyzer CI actually installed.
      // An unpinned install would silently drift away from the local pin.
      const installs = validateSteps.some((step) => step.run?.includes(scanner.version) === true);
      expect(installs, `the validate job does not install \`${id}\` at ${scanner.version}`).toBe(
        true,
      );
    },
  );

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

type OsvIgnore = {
  id: string;
  ignoreUntil: string;
  reason: string;
};

const expectedOsvIgnoreIds = [
  "GHSA-5p2g-fcmc-qvqq",
  "GHSA-67mh-4wv8-2f99",
  "GHSA-8988-4f7v-96qf",
  "GHSA-w3rx-r6r6-pgpr",
];

function parseOsvIgnores(content: string): { entries: OsvIgnore[]; problems: string[] } {
  const problems: string[] = [];
  let config: Record<string, unknown>;
  try {
    config = parseToml(content) as Record<string, unknown>;
  } catch (error) {
    return { entries: [], problems: [`invalid TOML: ${String(error)}`] };
  }

  for (const key of Object.keys(config)) {
    if (key !== "IgnoredVulns") problems.push(`forbidden top-level OSV config: ${key}`);
  }

  const rawEntries = config.IgnoredVulns;
  if (rawEntries !== undefined && !Array.isArray(rawEntries)) {
    problems.push("IgnoredVulns must be an array of exact entries");
  }
  const entries = (Array.isArray(rawEntries) ? rawEntries : []).flatMap((rawEntry, index) => {
    if (typeof rawEntry !== "object" || rawEntry === null || Array.isArray(rawEntry)) {
      problems.push(`entry ${index + 1} is not a TOML table`);
      return [];
    }
    const values = rawEntry as Record<string, unknown>;
    const unknownKeys = Object.keys(values).filter(
      (key) => !["id", "ignoreUntil", "reason"].includes(key),
    );
    for (const key of unknownKeys)
      problems.push(`entry ${index + 1} contains unknown field ${key}`);

    const id = typeof values.id === "string" ? values.id : "";
    const reason = typeof values.reason === "string" ? values.reason : "";
    const ignoreUntil =
      typeof values.ignoreUntil === "string"
        ? values.ignoreUntil
        : values.ignoreUntil instanceof Date
          ? values.ignoreUntil.toISOString().slice(0, 10)
          : "";
    if (!/^(?:GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}|CVE-\d{4}-\d{4,})$/.test(id)) {
      problems.push(`entry ${index + 1} does not name one exact advisory ID`);
    }
    if (reason.trim().length === 0) problems.push(`entry ${index + 1} has no reason`);
    if (!/(?:#\d+|https:\/\/)/.test(reason)) {
      problems.push(`entry ${index + 1} has no durable tracking reference`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ignoreUntil)) {
      problems.push(`entry ${index + 1} has no TOML local-date expiry`);
    }
    return [{ id, ignoreUntil, reason }];
  });

  const duplicateIds = entries
    .map((entry) => entry.id)
    .filter((id, index, ids) => id.length > 0 && ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) problems.push(`duplicate advisory IDs: ${duplicateIds.join(", ")}`);

  return { entries, problems };
}

function expiryProblems(entries: OsvIgnore[], today = new Date()): string[] {
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const maximumExpiry = todayUtc + 90 * 24 * 60 * 60 * 1000;
  return entries.flatMap((entry) => {
    const parsed = Date.parse(`${entry.ignoreUntil}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return [`${entry.id} has an invalid expiry`];
    if (parsed <= todayUtc) return [`${entry.id} is expired`];
    if (parsed > maximumExpiry) return [`${entry.id} expires more than 90 days from review`];
    return [];
  });
}

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

  it.each([".*", ".+", "*", "", "^.*$"])(
    "flags %j as a catch-all however it is justified",
    (pattern) => {
      // Justification does not launder a pattern that silences the scanner.
      expect(
        unjustifiedSuppressions(`# reviewed\npaths = [\n  '''${pattern}''',\n]\n`),
      ).toHaveLength(1);
    },
  );

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

  it("keeps .gitleaks.toml free of broad or unexplained suppressions", () => {
    const relativePath = ".gitleaks.toml";
    const content = readFileSync(path.join(repoRoot, relativePath), "utf8");
    expect(unjustifiedSuppressions(content)).toEqual([]);
  });

  it("rejects malformed, broad, permanent, or untracked OSV suppressions", () => {
    const valid = [
      "[[IgnoredVulns]]",
      'id = "GHSA-aaaa-bbbb-cccc"',
      "ignoreUntil = 2026-09-01",
      'reason = "Tracked by #177."',
    ].join("\n");
    expect(parseOsvIgnores(valid).problems).toEqual([]);
    expect(
      expiryProblems(parseOsvIgnores(valid).entries, new Date("2026-08-08T00:00:00Z")),
    ).toEqual([]);

    for (const invalid of [
      valid.replace("GHSA-aaaa-bbbb-cccc", "*"),
      valid.replace('reason = "Tracked by #177."', 'reason = ""'),
      valid.replace("Tracked by #177.", "No tracking reference."),
      valid.replace("ignoreUntil = 2026-09-01\n", ""),
      `${valid}\nunknown = true`,
      '[[PackageOverrides]]\nname = "image-size"\nignore = true',
      '[[ PackageOverrides ]]\nname = "image-size"\nignore = true',
      'PackageOverrides = [{ name = "image-size", ignore = true }]',
      `${valid}\n${valid}`,
    ]) {
      expect(parseOsvIgnores(invalid).problems.length, invalid).toBeGreaterThan(0);
    }
    expect(
      expiryProblems(parseOsvIgnores(valid).entries, new Date("2026-09-01T00:00:00Z")),
    ).toEqual(["GHSA-aaaa-bbbb-cccc is expired"]);
  });

  it("keeps every residual OSV suppression exact, expiring, and documented", () => {
    const content = readFileSync(path.join(repoRoot, "osv-scanner.toml"), "utf8");
    const parsed = parseOsvIgnores(content);
    expect(parsed.problems).toEqual([]);
    expect(expiryProblems(parsed.entries)).toEqual([]);
    expect(parsed.entries.map((entry) => entry.id).sort()).toEqual(expectedOsvIgnoreIds);

    for (const entry of parsed.entries) {
      const rows = securityReviewSource
        .split("\n")
        .filter((line) => line.startsWith("|") && line.includes(entry.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(entry.ignoreUntil);
      expect(rows[0]).toContain(entry.reason.match(/#\d+|https:\/\/[^ )]+/)?.[0]);
      if (["GHSA-5p2g-fcmc-qvqq", "GHSA-w3rx-r6r6-pgpr"].includes(entry.id)) {
        expect(entry.reason).toMatch(/repository patch/i);
        expect(rows[0]).toContain("locally fixed");
      }
    }
  });

  it("does not configure an OSV ignore flag outside the reviewed TOML baseline", () => {
    expect(scannerRegistry.find((scanner) => scanner.id === "osv")?.scanArgs.join(" ")).not.toMatch(
      /--ignore|--config-override/,
    );
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

/**
 * Returns the body of a Markdown section: the lines after `heading`, up to the
 * next heading at the same or a shallower level.
 *
 * Stopping at a heading of *any* level would silently truncate the section at a
 * `####` subsection, so deferred work filed under one would never be read. It
 * stays in the body instead, where `deferralProblems` rejects it. Fenced blocks
 * are skipped so a Markdown example earlier in the file cannot shadow the real
 * heading; a duplicated real heading is markdownlint's MD024 to catch.
 */
function sectionBody(source: string, heading: string): string {
  const level = (/^#+/.exec(heading)?.[0] ?? "").length;
  const lines = source.split("\n");
  let fenced = false;
  let start = -1;
  for (const [index, line] of lines.entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.trim() === heading) {
      start = index;
      break;
    }
  }
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => new RegExp(`^#{1,${level}}\\s`).test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

const listMarker = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * Folds a section into logical items. Checking raw lines would fail every entry
 * long enough to wrap at this repository's 80-column margin.
 *
 * A wrapped continuation is indented under its list item, so an *unindented*
 * line always starts a new item — that is what stops a paragraph appended below
 * a bullet from inheriting the bullet's issue link. Indented sub-bullets fold
 * into their parent, which already carries the tracker for that lane.
 *
 * Known limit: text indented directly beneath a tracked bullet is
 * indistinguishable from that bullet's own wrapped continuation, so it inherits
 * the tracker. This check is a guard against the prose deferral that actually
 * occurred, not a defence against an author working to evade it.
 */
function markdownItems(section: string): string[] {
  const items: string[] = [];
  let inList = false;
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      items.push("");
      inList = false;
      continue;
    }
    const isListItem = listMarker.test(line);
    const previous = items.at(-1);
    const continues =
      previous !== undefined && previous !== "" && (inList ? /^\s/.test(line) : !isListItem);
    if (continues) {
      items[items.length - 1] = `${previous} ${trimmed}`;
    } else {
      items.push(trimmed);
      inList = isListItem;
    }
  }
  return items.filter((item) => item.length > 0);
}

const excerpt = (item: string) => (item.length > 60 ? `${item.slice(0, 60)}…` : item);

/**
 * A resolvable link to an issue in this repository, rather than a bare `#123`.
 * `#\d+` alone also matches a hex colour, a heading anchor, and a number inside
 * a code span, none of which track anything. The label and the URL must name
 * the same issue, so a link cannot say one thing and point at another.
 */
const issueLink = /\[#(\d+)\]\(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)\)/g;

const tracksAnIssue = (item: string) =>
  [...item.matchAll(issueLink)].some((match) => match[1] === match[2]);

/**
 * Deferred work must be a list item linking the issue that carries it. A lead-in
 * ending in `:` immediately before the list introduces it and makes no claim of
 * its own; anything else outside the list is an untracked deferral.
 *
 * Requiring a *list item with a link* rather than merely some `#N` in the
 * section is load-bearing: the prose this replaced already mentioned #175, the
 * issue it was deferred *from*, so a looser check would have passed while the
 * deferred work had no tracker at all.
 *
 * Known limit: nothing here proves the linked issue exists or is still open —
 * `tests/AGENTS.md` rule 6 forbids a test reaching the network. Tracker rot
 * after the fact is a review concern, not one this check can see.
 */
function deferralProblems(section: string): string[] {
  const items = markdownItems(section);
  if (items.length === 0) return ["the Deferred section is empty"];

  const problems: string[] = [];
  items.forEach((item, index) => {
    if (!listMarker.test(item)) {
      const introducesList = item.endsWith(":") && listMarker.test(items[index + 1] ?? "");
      if (!introducesList) {
        // Name both accepted shapes: the commonest cause of this failure is a
        // lead-in that lost its colon, not an untracked deferral.
        problems.push(
          `deferred work must be a list item linking its issue, or a lead-in ending in ":" directly above the list: ${excerpt(item)}`,
        );
      }
      return;
    }
    if (!tracksAnIssue(item)) {
      problems.push(`deferred item links no tracking issue: ${excerpt(item)}`);
    }
  });
  if (!items.some((item) => listMarker.test(item))) {
    problems.push("the Deferred section lists no tracked items");
  }
  return problems;
}

const trackedExample =
  "- Broad Semgrep ([#231](https://github.com/ncolesummers/loopworks/issues/231)).";

describe("deferred lanes", () => {
  it("binds every deferred security lane to a tracking issue", () => {
    // The advisory broad-Semgrep and ZAP lanes were deferred from #175 as prose
    // here and in ADR 0024. Prose is not a commitment: once #175 closes, a
    // deferral that names no tracker is indistinguishable from abandoned work.
    const section = sectionBody(securityReviewSource, "### Deferred");
    expect(section.trim(), "docs/security-review.md has no `### Deferred` section").not.toBe("");
    expect(deferralProblems(section)).toEqual([]);
  });

  it("rejects a deferral that names no tracker", () => {
    // Control cases, so the assertion above cannot pass vacuously.
    expect(deferralProblems("")).toEqual(["the Deferred section is empty"]);
    expect(
      deferralProblems(
        "Broad Semgrep rules and ZAP against a production-mode deployment\nare deferred until their baselines have been reviewed.",
      ),
    ).not.toEqual([]);
    expect(deferralProblems(`Tracked separately:\n\n${trackedExample}`)).toEqual([]);

    // A bullet with no link at all.
    expect(deferralProblems("Tracked separately:\n\n- Something deferred.")).toEqual([
      "deferred item links no tracking issue: - Something deferred.",
    ]);
    // A bullet ending in `:` must not inherit the lead-in exemption.
    expect(
      deferralProblems(`Tracked separately:\n\n- Deferred for these reasons:\n\n${trackedExample}`),
    ).toContainEqual("deferred item links no tracking issue: - Deferred for these reasons:");
    // A reference that is not a resolvable issue link.
    for (const fake of ["#231000", "[section](#2-scope)", "`#231`", "[#231](https://x)"]) {
      expect(
        deferralProblems(`Tracked separately:\n\n- Something deferred ${fake}.`),
        fake,
      ).not.toEqual([]);
    }
    // A label that points at a different issue than it names.
    expect(
      deferralProblems(
        "Tracked separately:\n\n- Deferred ([#231](https://github.com/ncolesummers/loopworks/issues/999)).",
      ),
    ).not.toEqual([]);
    // Prose appended below the list, and prose under a nested sub-heading.
    expect(
      deferralProblems(`${trackedExample}\n\nZAP is deferred with no tracker.`),
    ).toContainEqual(
      `deferred work must be a list item linking its issue, or a lead-in ending in ":" directly above the list: ZAP is deferred with no tracker.`,
    );
    expect(
      deferralProblems(`${trackedExample}\n\n#### Also deferred\n\nZAP, tracked nowhere.`),
    ).not.toEqual([]);
  });

  it("accepts the ordinary Markdown shapes a maintainer would reach for", () => {
    // The section must stay editable. An ordered list, a `+` marker, and an
    // indented sub-bullet under a tracked lane are all correct Markdown, and a
    // check that rejected them would be worked around rather than satisfied.
    const link = "[#232](https://github.com/ncolesummers/loopworks/issues/232)";
    expect(deferralProblems(`1. Broad Semgrep ${link}.`)).toEqual([]);
    expect(deferralProblems(`+ Broad Semgrep ${link}.`)).toEqual([]);
    expect(
      deferralProblems(`- Broad Semgrep ${link}.\n  - Needs a baseline review first.`),
    ).toEqual([]);
  });
});
