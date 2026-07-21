/** @vitest-environment node */
import { readFile } from "node:fs/promises";
import {
  createValidationReportArtifactMetadata,
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
    name: "Format check",
    command: "bun run format:check",
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
      command: "bun run format:check",
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
