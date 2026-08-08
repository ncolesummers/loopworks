/** @vitest-environment node */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { configRegistry } from "@/lib/config/registry";
import {
  createValidationReportArtifactMetadata,
  evaluateValidationCommand,
  runValidationGates,
  runValidationWithScreenshotEvidence,
  type ValidationCommandExecutionInput,
  type ValidationOutputWriterInput,
  validationReportSchemaId,
  validationReportV1Schema,
} from "@/lib/loops/validation-runner";
import type { LoopDefinition } from "../../../schemas/loop-manifest";

const fixtureGates = [
  {
    key: "format",
    name: "Biome check",
    command: "bun run check",
    required: true,
    phase: "before_implementation",
    produces: "validation_report",
  },
  {
    key: "unit-tests",
    name: "Unit tests",
    command: "bun test tests/unit/loops/validation-runner.test.ts",
    required: true,
    phase: "before_review",
    produces: "validation_report",
  },
  {
    key: "playwright",
    name: "Playwright",
    command: "bun run test:e2e",
    required: false,
    phase: "before_rollout",
    produces: "validation_report",
  },
] as const satisfies LoopDefinition["validationGates"];

function createSteppedClock() {
  let tick = 0;

  return () => new Date(Date.UTC(2026, 6, 8, 12, 0, tick++));
}

describe("deterministic validation runner", () => {
  it("allows the Biome gate that runs assists and rejects the ones that skip them", () => {
    // The allowlist is the only machine-enforced constraint on what a loop may
    // declare as a validation gate. Leaving the assist-blind commands in it
    // would let a loop emit a green validation report over unsorted imports —
    // the same hole in `validate` that this allowlist is now the last guard for.
    expect(evaluateValidationCommand("bun run check")).toMatchObject({ allowed: true });

    for (const command of ["bun run format:check", "bun run lint"]) {
      expect(evaluateValidationCommand(command), `\`${command}\` is still allowed`).toMatchObject({
        allowed: false,
      });
    }
  });

  it("classifies pass, fail, and skipped gates in manifest order", async () => {
    const executor = vi.fn(async ({ gate }: ValidationCommandExecutionInput) => ({
      exitCode: gate.key === "unit-tests" ? 1 : 0,
      stderr: gate.key === "unit-tests" ? "expected failure with token=secret-token" : "",
      stdout: gate.key === "unit-tests" ? "" : "ok with token=secret-token",
      truncated: false,
    }));
    const outputWriter = vi.fn(async ({ gate }: ValidationOutputWriterInput) => ({
      uri: `artifact://validation/${gate.key}.log`,
    }));

    const report = await runValidationGates({
      executor,
      gates: fixtureGates,
      now: createSteppedClock(),
      outputWriter,
      shouldSkipGate: (gate) =>
        gate.key === "playwright" ? "Playwright is not part of this fixture gate set." : undefined,
    });

    expect(report).toMatchObject({
      counts: {
        failed: 1,
        passed: 1,
        skipped: 1,
        total: 3,
      },
      generatedAt: "2026-07-08T12:00:00.000Z",
      overallOutcome: "fail",
      schemaId: validationReportSchemaId,
      version: 1,
    });
    expect(report.results.map((result) => result.key)).toEqual([
      "format",
      "unit-tests",
      "playwright",
    ]);
    expect(report.results.map((result) => result.outcome)).toEqual(["pass", "fail", "skipped"]);
    expect(report.results[0]).toMatchObject({
      command: "bun run check",
      durationMs: 1000,
      exitCode: 0,
      output: {
        stderrBytes: 0,
        stdoutBytes: 24,
        truncated: false,
        uri: "artifact://validation/format.log",
      },
    });
    expect(report.results[0]?.output).toMatchObject({
      stderrBytes: 0,
      stdoutBytes: 24,
    });
    expect(report.results[0]?.output?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.results[1]).toMatchObject({
      durationMs: 1000,
      exitCode: 1,
      output: {
        stderrBytes: 38,
        stdoutBytes: 0,
        uri: "artifact://validation/unit-tests.log",
      },
    });
    expect(report.results[2]).toMatchObject({
      durationMs: 0,
      exitCode: null,
      outcome: "skipped",
      skipReason: "Playwright is not part of this fixture gate set.",
    });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(outputWriter).toHaveBeenCalledTimes(2);
    expect(outputWriter.mock.calls.map(([input]) => input.stdout)).toEqual([
      "ok with token=[redacted]",
      "",
    ]);
    expect(outputWriter.mock.calls.map(([input]) => input.stderr)).toEqual([
      "",
      "expected failure with token=[redacted]",
    ]);
    expect(JSON.stringify(report)).not.toContain("secret-token");
    expect(validationReportV1Schema.parse(report)).toEqual(report);
  });

  it("stores a stable artifact metadata payload without raw command output", async () => {
    let writtenStdout: string | undefined;
    const outputWriter = vi.fn(async (input: ValidationOutputWriterInput) => {
      writtenStdout = input.stdout;
      return {
        uri: "artifact://validation/format.log",
      };
    });
    const report = await runValidationGates({
      executor: async () => ({
        exitCode: 0,
        stderr: "",
        stdout: "raw prompt token should not be embedded",
        truncated: false,
      }),
      gates: [fixtureGates[0]],
      now: createSteppedClock(),
      outputWriter,
    });

    const metadata = createValidationReportArtifactMetadata(report);

    expect(metadata).toMatchObject({
      detail: "Validation report: 1 passed, 0 failed, 0 skipped.",
      validationReportMetadataKind: "validation_report_result",
      validationReport: report,
      validationReportSchemaId,
      validationReportVersion: 1,
    });
    expect(writtenStdout).toBe("[redacted validation output line]");
    expect(JSON.stringify(metadata)).not.toContain("raw prompt token");
  });

  it("fails unsafe or unsupported commands without invoking the executor", async () => {
    const executor = vi.fn();

    for (const command of [
      "bun run test && curl https://example.com",
      "NODE_ENV=test bun run test",
      "curl https://example.com",
      "bun run format",
      "bun run db:seed:reset",
      "bunx cowsay validation",
    ]) {
      const report = await runValidationGates({
        executor,
        gates: [
          {
            ...fixtureGates[0],
            command,
          },
        ],
        now: createSteppedClock(),
      });

      expect(report.overallOutcome).toBe("fail");
      expect(report.results[0]).toMatchObject({
        command,
        durationMs: 0,
        exitCode: 126,
        outcome: "fail",
      });
    }

    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects validation report payloads with inconsistent downstream contract fields", async () => {
    const report = await runValidationGates({
      executor: async () => ({
        exitCode: 0,
        stderr: "",
        stdout: "",
        truncated: false,
      }),
      gates: [fixtureGates[0]],
      now: createSteppedClock(),
    });

    expect(() =>
      validationReportV1Schema.parse({
        ...report,
        counts: {
          ...report.counts,
          total: 2,
        },
      }),
    ).toThrow(/counts.total/);

    expect(() =>
      validationReportV1Schema.parse({
        ...report,
        results: [report.results[0], report.results[0]],
      }),
    ).toThrow(/unique/);

    expect(() =>
      validationReportV1Schema.parse({
        ...report,
        results: [{ ...report.results[0], command: "false", exitCode: 1, outcome: "pass" }],
      }),
    ).toThrow(/exitCode/);
  });

  it("keeps the runner independent from persistence and lifecycle telemetry", async () => {
    const source = await readFile("src/lib/loops/validation-runner.ts", "utf8");

    expect(source).not.toMatch(/@\/db|from "@/);
    expect(source).not.toContain("@/lib/observability");
    expect(source).not.toContain("loopRuns");
    expect(source).not.toContain("runSteps");
    expect(source).not.toContain(
      "nosemgrep: loopworks-no-environment-inheritance-into-agent-sandbox",
    );
  });

  it("runs a real validation gate without exposing parent secrets", async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "loopworks-validation-env-"));
    const secretNames = configRegistry.filter((entry) => entry.secret).map((entry) => entry.name);
    const requiredSecretNames = ["AUTH_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"];
    const originalPath = process.env.PATH;
    const parentEnvironment = process.env as Record<string, string | undefined>;
    const mutatedNames = [
      ...secretNames,
      "HOME",
      "CI",
      "NODE_ENV",
      "LOOPWORKS_SECURITY_REQUIRE_SCANNERS",
      "UNREGISTERED_ENV_SENTINEL",
    ];
    const originalEnvironment = new Map(
      mutatedNames.map((name) => [name, parentEnvironment[name]] as const),
    );

    expect(secretNames).toEqual(expect.arrayContaining(requiredSecretNames));
    expect(originalPath).toBeTruthy();

    try {
      for (const name of secretNames) {
        parentEnvironment[name] = `issue-178-${name.toLowerCase()}`;
      }
      parentEnvironment.HOME = fixtureRoot;
      parentEnvironment.CI = "true";
      parentEnvironment.NODE_ENV = "production";
      parentEnvironment.LOOPWORKS_SECURITY_REQUIRE_SCANNERS = "true";
      parentEnvironment.UNREGISTERED_ENV_SENTINEL = "must-not-cross";

      const expectedEnvironment = {
        CI: "true",
        HOME: fixtureRoot,
        LOOPWORKS_SECURITY_REQUIRE_SCANNERS: "true",
        PATH: originalPath,
      };
      const probeSource = `
const secretNames = ${JSON.stringify(secretNames)};
const expectedEnvironment = ${JSON.stringify(expectedEnvironment)};
const leakedNames = secretNames.filter((name) => process.env[name] !== undefined);
const allowedEnvironmentMatches = Object.entries(expectedEnvironment).every(
  ([name, value]) =>
    name === "PATH" ? process.env.PATH?.includes(value) === true : process.env[name] === value,
);
const productionModeLeaked = process.env.NODE_ENV === "production";
const unknownEnvironmentLeaked = process.env.UNREGISTERED_ENV_SENTINEL !== undefined;
if (
  leakedNames.length > 0 ||
  !allowedEnvironmentMatches ||
  productionModeLeaked ||
  unknownEnvironmentLeaked
) {
  console.error(
    JSON.stringify({
      allowedEnvironmentMatches,
      leakedNames,
      productionModeLeaked,
      unknownEnvironmentLeaked,
    }),
  );
  process.exit(1);
}
`;

      await writeFile(
        path.join(fixtureRoot, "package.json"),
        `${JSON.stringify({ scripts: { check: "bun run probe.ts" } }, null, 2)}\n`,
      );
      await writeFile(path.join(fixtureRoot, "probe.ts"), probeSource);

      let commandOutput: { stderr: string; stdout: string } | undefined;
      const report = await runValidationGates({
        cwd: fixtureRoot,
        gates: [fixtureGates[0]],
        now: createSteppedClock(),
        outputWriter: ({ stderr, stdout }) => {
          commandOutput = { stderr, stdout };
          return { uri: "artifact://validation/environment-probe.log" };
        },
      });

      expect(report, JSON.stringify(commandOutput)).toMatchObject({
        counts: { failed: 0, passed: 1, skipped: 0, total: 1 },
        overallOutcome: "pass",
        results: [{ exitCode: 0, outcome: "pass" }],
      });
    } finally {
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) delete parentEnvironment[name];
        else parentEnvironment[name] = value;
      }
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it("runs validation-owned screenshot capture only after deterministic gates pass", async () => {
    const capture = vi.fn();
    const result = await runValidationWithScreenshotEvidence({
      executor: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      gates: [fixtureGates[0]],
      now: createSteppedClock(),
      screenshot: {
        binding: {
          repositoryFullName: "ncolesummers/loopworks",
          commitSha: "a".repeat(40),
          testPlanSha256: "b".repeat(64),
          productionPatchSha256: "c".repeat(64),
        },
        productionPaths: ["src/lib/parser.ts"],
        tests: [],
        capture,
        write: vi.fn(),
      },
    });

    expect(result.report.overallOutcome).toBe("pass");
    expect(result.screenshotEvidence).toMatchObject({ uiAffecting: false, captures: [] });
    expect(capture).not.toHaveBeenCalled();
  });
});
