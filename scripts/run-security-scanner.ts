import { spawnSync } from "node:child_process";

import { readSuppliedRawConfig } from "@/lib/config/registry";
import { isTruthyEnvValue } from "@/lib/runtime";

/** Where a scanner runs: the local `validate` chain, or CI only. */
export type ScannerLane = "validate" | "ci-only";

/**
 * What a *finding* does. Deliberately separate from the lane, and deliberately
 * expressed here rather than as `continue-on-error` in the workflow: an
 * advisory scanner still fails closed on a scanner error, a timeout, a version
 * mismatch, or a missing binary in CI. `continue-on-error` would swallow all of
 * those too, which is the failure mode #175 exists to prevent.
 */
export type ScannerEnforcement = "blocking" | "advisory";

export type ScannerDefinition = {
  /** Stable identifier, also the argument this script is invoked with. */
  id: string;
  /** Repository-owned command CI and the local chain both go through. */
  script: string;
  binary: string;
  /** Exact pinned version. A range would let CI and a laptop disagree. */
  version: string;
  versionArgs: readonly string[];
  scanArgs: readonly string[];
  installInstruction: string;
  lane: ScannerLane;
  enforcement: ScannerEnforcement;
  /**
   * Exit codes that mean "the scan completed and reported findings", as opposed
   * to "the scan did not complete". Without the distinction an advisory scanner
   * would also shrug off its own crashes.
   */
  findingExitCodes: readonly number[];
  timeoutMs: number;
};

export type ScannerObservation = {
  binaryPresent: boolean;
  installedVersion?: string;
  exitCode?: number;
  timedOut?: boolean;
  /**
   * Set when the scan was killed. Reported separately from `timedOut` so a
   * SIGSEGV or an OOM kill is not described as a timeout, which would send
   * whoever reads the failure hunting a performance problem that is not there.
   */
  killedBySignal?: string;
};

export type ScannerPolicy = {
  failClosedOnMissingBinary: boolean;
};

export type ScannerDisposition = "pass" | "skip" | "advisory" | "fail";

export type ScannerOutcome = {
  disposition: ScannerDisposition;
  reason: string;
};

/**
 * Every scanner runs with metrics, telemetry, and update checks disabled. The
 * gate has to be deterministic and offline: a scanner that phones home turns a
 * network blip into a failed commit, and `--redact` keeps a matched secret out
 * of CI logs, which are far more widely readable than the repository.
 */
export const scannerRegistry: readonly ScannerDefinition[] = [
  {
    id: "osv",
    script: "security:osv",
    binary: "osv-scanner",
    version: "2.5.0",
    versionArgs: ["--version"],
    scanArgs: ["scan", "source", "--recursive", "--config=osv-scanner.toml", "."],
    installInstruction: "brew install osv-scanner (pin 2.5.0)",
    lane: "validate",
    // Advisory for now, and only for now. The first scan of this repository
    // reported 98 vulnerabilities across 25 packages, most of them transitive
    // and not resolvable by a version bump. Blocking on day one would have
    // meant either a 98-entry baseline or a dependency rewrite smuggled into a
    // tooling change. The gate is wired, pinned, and reporting; #177
    // clears the backlog and flips this to `blocking`.
    enforcement: "advisory",
    findingExitCodes: [1],
    timeoutMs: 5 * 60_000,
  },
  {
    id: "gitleaks",
    script: "security:gitleaks",
    binary: "gitleaks",
    version: "8.30.1",
    versionArgs: ["version"],
    scanArgs: ["dir", ".", "--config=.gitleaks.toml", "--redact", "--no-banner", "--exit-code=1"],
    installInstruction: "brew install gitleaks (pin 8.30.1)",
    lane: "validate",
    enforcement: "blocking",
    findingExitCodes: [1],
    timeoutMs: 3 * 60_000,
  },
  {
    // History is CI-only: the local gate scans the working tree, which is what
    // a developer can still change before pushing. Measured at 205 commits it
    // is fast (~0.8s), so the split is about division of labour rather than
    // runtime, and this could be promoted into `validate` by changing `lane`
    // alone. Run it locally, unchanged, to reproduce a CI history failure.
    id: "gitleaks-history",
    script: "security:gitleaks:history",
    binary: "gitleaks",
    version: "8.30.1",
    versionArgs: ["version"],
    scanArgs: [
      "git",
      ".",
      "--log-opts=--all",
      "--config=.gitleaks.toml",
      "--redact",
      "--no-banner",
      "--exit-code=1",
    ],
    installInstruction: "brew install gitleaks (pin 8.30.1)",
    lane: "ci-only",
    enforcement: "blocking",
    findingExitCodes: [1],
    timeoutMs: 10 * 60_000,
  },
  {
    id: "semgrep",
    script: "security:semgrep",
    binary: "semgrep",
    version: "1.172.0",
    // The offline flags belong on the probe as well as the scan: bare
    // `semgrep --version` contacts the update service, so a blocked network
    // makes an installed semgrep look absent — locally that is a silent skip.
    versionArgs: ["--version", "--metrics=off", "--disable-version-check"],
    scanArgs: [
      "scan",
      "--config=.semgrep/loopworks.yml",
      "--error",
      "--quiet",
      "--metrics=off",
      "--disable-version-check",
      ".",
    ],
    installInstruction: "uv tool install semgrep==1.172.0",
    lane: "validate",
    enforcement: "blocking",
    // `--error` makes a finding exit 1; anything else is semgrep itself failing.
    findingExitCodes: [1],
    timeoutMs: 5 * 60_000,
  },
];

export function scannerById(id: string): ScannerDefinition {
  const scanner = scannerRegistry.find((candidate) => candidate.id === id);
  if (!scanner) {
    const known = scannerRegistry.map((candidate) => candidate.id).join(", ");
    throw new Error(`Unknown scanner: ${id}. Known scanners: ${known}`);
  }
  return scanner;
}

/**
 * Reads the first `major.minor.patch` in a version probe's output. The three
 * scanners print three different shapes (`8.30.1`, `osv-scanner version 2.5.0`,
 * `1.172.0`), and a probe that failed prints none, which must not be mistaken
 * for a match against the pin.
 */
export function parseSemanticVersion(output: string): string | undefined {
  // Not `\b`-anchored: `v8.30.1` has no word boundary between `v` and `8`. The
  // lookarounds instead reject a longer numeric run, so `1.2.3.4` is not read
  // as `1.2.3`.
  return /(?<![\d.])(\d+\.\d+\.\d+)(?![\d.])/.exec(output)?.[1];
}

/**
 * A missing binary is the one condition a developer may skip past. CI must
 * never skip, and a developer can opt into CI's behavior. Everything else — a
 * wrong version, a non-zero exit, a timeout — fails closed everywhere.
 */
export function resolveScannerPolicy(env: Partial<NodeJS.ProcessEnv>): ScannerPolicy {
  const inCi = isTruthyEnvValue(readSuppliedRawConfig("CI", env));
  const required = isTruthyEnvValue(
    readSuppliedRawConfig("LOOPWORKS_SECURITY_REQUIRE_SCANNERS", env),
  );
  return { failClosedOnMissingBinary: inCi || required };
}

export function resolveScannerOutcome(
  scanner: ScannerDefinition,
  observation: ScannerObservation,
  policy: ScannerPolicy,
): ScannerOutcome {
  if (!observation.binaryPresent) {
    const reason = `${scanner.binary} ${scanner.version} is not installed. Install it with: ${scanner.installInstruction}`;
    return policy.failClosedOnMissingBinary
      ? { disposition: "fail", reason }
      : { disposition: "skip", reason: `${reason} (skipped locally)` };
  }

  if (observation.installedVersion !== scanner.version) {
    // Not covered by the skip escape hatch: a mismatched binary is present and
    // analyzing, just with a different ruleset than the one we reviewed.
    return {
      disposition: "fail",
      reason: `${scanner.binary} is pinned to ${scanner.version} but ${observation.installedVersion ?? "an unreadable version"} is installed. Install it with: ${scanner.installInstruction}`,
    };
  }

  if (observation.timedOut === true) {
    return {
      disposition: "fail",
      reason: `${scanner.binary} timed out after ${scanner.timeoutMs}ms without producing a verdict`,
    };
  }

  if (observation.killedBySignal !== undefined) {
    return {
      disposition: "fail",
      reason: `${scanner.binary} was killed by ${observation.killedBySignal} without producing a verdict`,
    };
  }

  if (observation.exitCode === undefined) {
    // A spawn failure sets neither an exit code nor the timeout flag. Treating
    // that as a pass would disable the gate without any visible signal.
    return {
      disposition: "fail",
      reason: `${scanner.binary} did not run to completion`,
    };
  }

  if (observation.exitCode !== 0) {
    const reportedFindings = scanner.findingExitCodes.includes(observation.exitCode);
    if (reportedFindings && scanner.enforcement === "advisory") {
      return {
        disposition: "advisory",
        reason: `${scanner.binary} reported findings; this lane is advisory, so they are recorded rather than enforced`,
      };
    }
    return {
      disposition: "fail",
      reason: reportedFindings
        ? `${scanner.binary} reported findings`
        : `${scanner.binary} did not complete: exited ${observation.exitCode}`,
    };
  }

  return { disposition: "pass", reason: `${scanner.binary} ${scanner.version} found no findings` };
}

function observe(scanner: ScannerDefinition, cwd: string): ScannerObservation {
  const probe = spawnSync(scanner.binary, [...scanner.versionArgs], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (probe.error !== undefined || probe.status === null) {
    return { binaryPresent: false };
  }

  // Resolve the version before scanning. Running the scan first would analyze
  // the tree with a ruleset we never reviewed, only to discard the result.
  const installedVersion = parseSemanticVersion(`${probe.stdout}${probe.stderr}`);
  if (installedVersion !== scanner.version) {
    return { binaryPresent: true, installedVersion };
  }

  const scan = spawnSync(scanner.binary, [...scanner.scanArgs], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "inherit", "inherit"],
    timeout: scanner.timeoutMs,
  });

  // Node reports a killed child through the signal rather than the code, and
  // flags the timeout case specifically through `error.code`. Reading only the
  // signal would file every crash as a timeout.
  const timedOut = (scan.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return {
    binaryPresent: true,
    installedVersion,
    exitCode: scan.status ?? undefined,
    timedOut,
    killedBySignal: !timedOut && scan.signal !== null ? scan.signal : undefined,
  };
}

if (import.meta.main) {
  const scanner = scannerById(process.argv[2] ?? "");
  const outcome = resolveScannerOutcome(
    scanner,
    observe(scanner, process.cwd()),
    resolveScannerPolicy(process.env),
  );

  if (outcome.disposition === "fail") {
    console.error(`${scanner.script}: ${outcome.reason}`);
    process.exitCode = 1;
  } else if (outcome.disposition === "skip" || outcome.disposition === "advisory") {
    console.warn(`${scanner.script}: ${outcome.reason}`);
  }
}
