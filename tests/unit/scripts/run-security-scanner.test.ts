import { describe, expect, it } from "vitest";

import {
  parseSemanticVersion,
  resolveScannerOutcome,
  resolveScannerPolicy,
  type ScannerDefinition,
  type ScannerObservation,
  scannerById,
  scannerRegistry,
} from "../../../scripts/run-security-scanner";

const gitleaks = scannerById("gitleaks");

/**
 * A binary that is present and matching, having exited zero. Each test below
 * perturbs exactly one field, so a failure names the condition it is about
 * rather than an incidental difference in the fixture.
 */
function healthy(overrides: Partial<ScannerObservation> = {}): ScannerObservation {
  return { binaryPresent: true, installedVersion: gitleaks.version, exitCode: 0, ...overrides };
}

const permissive = { failClosedOnMissingBinary: false };
const strict = { failClosedOnMissingBinary: true };

describe("security scanner registry", () => {
  it("is not empty", () => {
    expect(scannerRegistry.length).toBeGreaterThan(0);
  });

  it.each(
    scannerRegistry.map((scanner) => [scanner.id, scanner] as const),
  )("pins `%s` to an exact version with an install instruction", (_id, scanner: ScannerDefinition) => {
    // A range or a floating tag would let CI and a developer machine run
    // different analyzers while both reported the gate as passing.
    expect(scanner.version, `\`${scanner.id}\` is not pinned to an exact version`).toMatch(
      /^\d+\.\d+\.\d+$/,
    );
    // The skip path is only defensible if it tells the developer how to stop
    // skipping. Without this, a silent skip is indistinguishable from a pass.
    expect(scanner.installInstruction.trim().length).toBeGreaterThan(0);
    expect(scanner.script).toMatch(/^security:/);
    expect(scanner.scanArgs.length).toBeGreaterThan(0);
    expect(scanner.timeoutMs).toBeGreaterThan(0);
  });

  it("gives every scanner a distinct id and script", () => {
    expect(new Set(scannerRegistry.map((scanner) => scanner.id)).size).toBe(scannerRegistry.length);
    expect(new Set(scannerRegistry.map((scanner) => scanner.script)).size).toBe(
      scannerRegistry.length,
    );
  });

  it("runs all three scanners from the validate lane", () => {
    const validateLane = scannerRegistry
      .filter((scanner) => scanner.lane === "validate")
      .map((scanner) => scanner.id)
      .sort();
    expect(validateLane).toEqual(["gitleaks", "osv", "semgrep"]);
  });

  it("keeps the committed-history scan in the CI-only lane", () => {
    // Asserted as an explicit list rather than derived. `it.each` over a
    // filtered registry registers *zero tests* when the filter is empty, so
    // deleting this scanner outright would have silently removed its coverage
    // along with the scanner.
    const ciOnly = scannerRegistry
      .filter((scanner) => scanner.lane === "ci-only")
      .map((scanner) => scanner.id);
    expect(ciOnly).toEqual(["gitleaks-history"]);
  });

  it.each([
    ["osv", "--config=osv-scanner.toml"],
    ["gitleaks", "--exit-code=1"],
    ["gitleaks", "--config=.gitleaks.toml"],
    ["gitleaks", "--redact"],
    ["gitleaks-history", "--exit-code=1"],
    ["gitleaks-history", "--log-opts=--all"],
    ["semgrep", "--error"],
    ["semgrep", "--config=.semgrep/loopworks.yml"],
  ])("keeps `%s` invoked with `%s`", (id, argument) => {
    // Arguments are load-bearing, not cosmetic. Dropping `--error` makes
    // semgrep exit 0 on findings; dropping `--exit-code=1` does the same for
    // gitleaks; dropping `--config` points a scanner at default rules nobody
    // reviewed. Each of those disables a gate while leaving it visibly wired.
    expect(scannerById(id).scanArgs).toContain(argument);
  });

  it("keeps `--redact` on every gitleaks invocation", () => {
    // CI logs are far more widely readable than the repository, so a matched
    // secret must never be echoed into one.
    for (const scanner of scannerRegistry.filter((entry) => entry.binary === "gitleaks")) {
      expect(scanner.scanArgs, `${scanner.id} does not redact`).toContain("--redact");
    }
  });

  it("enforces secret and code findings, and records dependency findings", () => {
    // Pinned deliberately: OSV is the one advisory lane, and it is advisory
    // only until the dependency backlog is cleared. If a second scanner ever
    // becomes advisory it should be a decision, not a default that slipped in.
    const advisory = scannerRegistry
      .filter((scanner) => scanner.enforcement === "advisory")
      .map((scanner) => scanner.id);
    expect(advisory).toEqual(["osv"]);
  });

  it.each(
    scannerRegistry.map((scanner) => [scanner.id, scanner] as const),
  )("distinguishes findings from failures for `%s`", (_id, scanner: ScannerDefinition) => {
    // Zero can never mean "findings", or a clean scan would be reported as a
    // finding and every run would fail.
    expect(scanner.findingExitCodes).not.toContain(0);
    expect(scanner.findingExitCodes.length).toBeGreaterThan(0);
  });

  it("rejects an unknown scanner id", () => {
    expect(() => scannerById("nope")).toThrow(/unknown scanner/i);
  });
});

describe("parseSemanticVersion", () => {
  it.each([
    ["8.30.1", "8.30.1"],
    ["osv-scanner version 2.5.0\ncommit: abc123", "2.5.0"],
    ["1.172.0\n", "1.172.0"],
    ["v8.30.1", "8.30.1"],
  ])("reads %j as %j", (output, expected) => {
    expect(parseSemanticVersion(output)).toBe(expected);
  });

  it("returns undefined when no version is present", () => {
    // A probe that printed a usage error must not be mistaken for a match
    // against the pinned version.
    expect(parseSemanticVersion("command not found")).toBeUndefined();
  });
});

describe("resolveScannerPolicy", () => {
  it("fails closed under CI", () => {
    expect(resolveScannerPolicy({ CI: "true" })).toEqual(strict);
  });

  it("fails closed when a developer opts in", () => {
    expect(resolveScannerPolicy({ LOOPWORKS_SECURITY_REQUIRE_SCANNERS: "true" })).toEqual(strict);
  });

  it("permits skipping on a bare developer machine", () => {
    expect(resolveScannerPolicy({})).toEqual(permissive);
  });

  it("does not treat a falsy CI value as CI", () => {
    // GitHub sets CI=true, but other runners export CI=false rather than
    // unsetting it; reading presence alone would flip local runs to strict.
    expect(resolveScannerPolicy({ CI: "false" })).toEqual(permissive);
  });
});

describe("resolveScannerOutcome", () => {
  it("passes when the pinned binary exits zero", () => {
    expect(resolveScannerOutcome(gitleaks, healthy(), permissive).disposition).toBe("pass");
    expect(resolveScannerOutcome(gitleaks, healthy(), strict).disposition).toBe("pass");
  });

  it("skips a missing binary only under the permissive policy", () => {
    const outcome = resolveScannerOutcome(gitleaks, { binaryPresent: false }, permissive);
    expect(outcome.disposition).toBe("skip");
    // The reason is the whole justification for allowing a skip at all.
    expect(outcome.reason).toContain(gitleaks.installInstruction);
  });

  it("fails a missing binary under the strict policy", () => {
    const outcome = resolveScannerOutcome(gitleaks, { binaryPresent: false }, strict);
    expect(outcome.disposition).toBe("fail");
    expect(outcome.reason).toContain(gitleaks.binary);
  });

  it("fails a version mismatch under either policy", () => {
    // A wrong version is a scanner that is present and analyzing with different
    // rules, not an absent one, so the local escape hatch must not cover it.
    for (const policy of [permissive, strict]) {
      const outcome = resolveScannerOutcome(
        gitleaks,
        healthy({ installedVersion: "8.0.0" }),
        policy,
      );
      expect(outcome.disposition).toBe("fail");
      expect(outcome.reason).toContain("8.0.0");
      expect(outcome.reason).toContain(gitleaks.version);
    }
  });

  it("fails when the version could not be read at all", () => {
    for (const policy of [permissive, strict]) {
      expect(
        resolveScannerOutcome(gitleaks, healthy({ installedVersion: undefined }), policy)
          .disposition,
      ).toBe("fail");
    }
  });

  it("fails a blocking scanner that reported findings", () => {
    for (const policy of [permissive, strict]) {
      expect(resolveScannerOutcome(gitleaks, healthy({ exitCode: 1 }), policy).disposition).toBe(
        "fail",
      );
    }
  });

  it("records rather than enforces findings from an advisory scanner", () => {
    const osv = scannerById("osv");
    for (const policy of [permissive, strict]) {
      const outcome = resolveScannerOutcome(
        osv,
        { binaryPresent: true, installedVersion: osv.version, exitCode: osv.findingExitCodes[0] },
        policy,
      );
      expect(outcome.disposition).toBe("advisory");
    }
  });

  it("fails an advisory scanner that did not complete", () => {
    // The whole point of separating findings from failures: `advisory` covers
    // what the scanner found, never whether the scanner ran.
    const osv = scannerById("osv");
    const crashed = { binaryPresent: true, installedVersion: osv.version, exitCode: 127 };
    expect(resolveScannerOutcome(osv, crashed, permissive).disposition).toBe("fail");
    expect(
      resolveScannerOutcome(osv, { ...crashed, exitCode: undefined, timedOut: true }, permissive)
        .disposition,
    ).toBe("fail");
    expect(resolveScannerOutcome(osv, { binaryPresent: false }, strict).disposition).toBe("fail");
  });

  it("fails a timeout under either policy", () => {
    // A timed-out scan produced no verdict. Treating it as anything but a
    // failure is the partial-result acceptance #175 explicitly prohibits.
    for (const policy of [permissive, strict]) {
      const outcome = resolveScannerOutcome(
        gitleaks,
        healthy({ exitCode: undefined, timedOut: true }),
        policy,
      );
      expect(outcome.disposition).toBe("fail");
      expect(outcome.reason).toMatch(/timed out/i);
    }
  });

  it("fails when the scanner produced no exit code and did not time out", () => {
    // A spawn error (ENOENT on a directory, permission denied) leaves neither
    // signal set; defaulting that to pass would silently disable the gate.
    for (const policy of [permissive, strict]) {
      expect(
        resolveScannerOutcome(gitleaks, healthy({ exitCode: undefined }), policy).disposition,
      ).toBe("fail");
    }
  });
});
