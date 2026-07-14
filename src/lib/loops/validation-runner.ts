import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  type CaptureValidationScreenshotsInput,
  captureValidationScreenshots,
  type ScreenshotEvidence,
} from "./screenshot-evidence";
import {
  type ValidationGate,
  type ValidationGateOutcome,
  type ValidationGateResultV1,
  type ValidationOutputReference,
  type ValidationReportV1,
  validationReportSchemaId,
  validationReportV1Schema,
  validationReportVersion,
} from "./validation-report";

export {
  createValidationReportArtifactContractMetadata,
  createValidationReportArtifactMetadata,
  summarizeValidationReport,
  type ValidationGate,
  type ValidationGateOutcome,
  type ValidationGateResultV1,
  type ValidationOutputReference,
  type ValidationReportArtifactMetadata,
  type ValidationReportV1,
  validationGateOutcomeValues,
  validationGateResultV1Schema,
  validationOutputReferenceSchema,
  validationReportArtifactMetadataSchema,
  validationReportSchemaId,
  validationReportV1Schema,
  validationReportVersion,
} from "./validation-report";

const allowedBunRunScripts = new Set([
  "agent-docs:check",
  "build",
  "format:check",
  "lint",
  "markdownlint",
  "storybook:build",
  "test",
  "test:e2e",
  "test:e2e:validation-evidence",
  "typecheck",
  "validate",
]);
const allowedBunRunScriptsWithArgs = new Set(["test", "test:e2e", "test:e2e:validation-evidence"]);
const defaultTimeoutMs = 10 * 60_000;
const defaultMaxOutputBytes = 128_000;
const shellConstructPattern = /&&|\|\||[;|<>`$\\\n\r]/;
const envAssignmentPattern = /^[A-Za-z_][A-Za-z0-9_]*=/;
const sensitiveAssignmentPattern =
  /\b(token|secret|password|authorization|credential|api[-_]?key|prompt)(\s*[:=]\s*)([^\s]+)/gi;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const commonTokenPattern = /\b(gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g;
const promptLikeLinePattern = /\bprompt\b/i;

export type ValidationCommandEvaluation =
  | {
      allowed: true;
      args: string[];
      file: string;
    }
  | {
      allowed: false;
      reason: string;
    };

export type ValidationCommandExecutionInput = {
  args: string[];
  command: string;
  cwd: string;
  file: string;
  gate: ValidationGate;
  maxOutputBytes: number;
  timeoutMs: number;
};

export type ValidationCommandExecutionResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
  truncated?: boolean;
};

export type ValidationCommandExecutor = (
  input: ValidationCommandExecutionInput,
) => Promise<ValidationCommandExecutionResult> | ValidationCommandExecutionResult;

export type ValidationOutputWriterInput = {
  command: string;
  exitCode: number;
  gate: ValidationGate;
  stderr: string;
  stdout: string;
  truncated: boolean;
};

export type ValidationOutputWriterResult = {
  stderrBytes?: number;
  stdoutBytes?: number;
  sha256?: string;
  truncated?: boolean;
  uri: string;
};

export type ValidationOutputWriter = (
  input: ValidationOutputWriterInput,
) => Promise<ValidationOutputWriterResult> | ValidationOutputWriterResult;

export type ValidationGateSkipDecision =
  | boolean
  | string
  | {
      reason: string;
    }
  | null
  | undefined;

export type RunValidationGatesInput = {
  cwd?: string;
  executor?: ValidationCommandExecutor;
  gates: readonly ValidationGate[];
  maxOutputBytes?: number;
  now?: () => Date;
  outputWriter?: ValidationOutputWriter;
  shouldSkipGate?: (gate: ValidationGate) => ValidationGateSkipDecision;
  timeoutMs?: number;
};

export type RunValidationWithScreenshotEvidenceInput = RunValidationGatesInput & {
  screenshot: CaptureValidationScreenshotsInput;
};

function parseValidationCommand(command: string): string[] {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unterminated quoted argument.");
  }

  if (current) {
    argv.push(current);
  }

  return argv;
}

export function evaluateValidationCommand(command: string): ValidationCommandEvaluation {
  if (shellConstructPattern.test(command)) {
    return {
      allowed: false,
      reason: "Shell constructs are blocked for deterministic validation gates.",
    };
  }

  let argv: string[];
  try {
    argv = parseValidationCommand(command);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "Invalid validation command.",
    };
  }

  const [file, ...args] = argv;
  if (!file) {
    return { allowed: false, reason: "Validation command is required." };
  }

  if (argv.some((arg) => envAssignmentPattern.test(arg))) {
    return {
      allowed: false,
      reason: "Environment assignment is blocked for deterministic validation gates.",
    };
  }

  if (file.includes("/") || file !== "bun") {
    return {
      allowed: false,
      reason: `${file} is not an allowed validation command family.`,
    };
  }

  const [verb, script, ...scriptArgs] = args;
  if (verb === "run") {
    if (!script || !allowedBunRunScripts.has(script)) {
      return {
        allowed: false,
        reason: `${script ?? "missing script"} is not an allowed validation script.`,
      };
    }

    if (scriptArgs.length > 0 && !allowedBunRunScriptsWithArgs.has(script)) {
      return {
        allowed: false,
        reason: `${script} does not support validation runner arguments.`,
      };
    }

    return {
      allowed: true,
      args,
      file,
    };
  }

  if (verb !== "test") {
    return {
      allowed: false,
      reason: `bun ${verb ?? "missing command"} is not an allowed validation command.`,
    };
  }

  return {
    allowed: true,
    args,
    file,
  };
}

function normalizeSkipReason(decision: ValidationGateSkipDecision): string | undefined {
  if (decision === true) {
    return "Validation gate skipped.";
  }

  if (typeof decision === "string" && decision.trim()) {
    return decision.trim();
  }

  if (typeof decision === "object" && decision?.reason.trim()) {
    return decision.reason.trim();
  }

  return undefined;
}

function getOutputBytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function hashValidationOutput(stdout: string, stderr: string): string {
  return createHash("sha256").update(stdout).update("\0").update(stderr).digest("hex");
}

export function redactValidationOutput(value: string): string {
  const redacted = value
    .replace(bearerTokenPattern, "Bearer [redacted]")
    .replace(commonTokenPattern, "[redacted-token]")
    .replace(
      sensitiveAssignmentPattern,
      (_match, key: string, separator: string) => `${key}${separator}[redacted]`,
    );

  return redacted
    .split(/\r?\n/)
    .map((line) =>
      promptLikeLinePattern.test(line) && !line.includes("[redacted]")
        ? "[redacted validation output line]"
        : line,
    )
    .join("\n");
}

async function createOutputReference(input: {
  command: string;
  exitCode: number;
  gate: ValidationGate;
  outputWriter?: ValidationOutputWriter;
  stderr: string;
  stdout: string;
  truncated: boolean;
}): Promise<ValidationOutputReference | undefined> {
  if (!input.outputWriter || (!input.stdout && !input.stderr)) {
    return undefined;
  }

  const stdout = redactValidationOutput(input.stdout);
  const stderr = redactValidationOutput(input.stderr);
  const stdoutBytes = getOutputBytes(stdout);
  const stderrBytes = getOutputBytes(stderr);
  const written = await input.outputWriter({
    command: input.command,
    exitCode: input.exitCode,
    gate: input.gate,
    stderr,
    stdout,
    truncated: input.truncated,
  });

  return {
    stderrBytes: written.stderrBytes ?? stderrBytes,
    stdoutBytes: written.stdoutBytes ?? stdoutBytes,
    sha256: written.sha256 ?? hashValidationOutput(stdout, stderr),
    truncated: written.truncated ?? input.truncated,
    uri: written.uri,
  };
}

function summarizeResults(results: readonly ValidationGateResultV1[]) {
  const passed = results.filter((result) => result.outcome === "pass").length;
  const failed = results.filter((result) => result.outcome === "fail").length;
  const skipped = results.filter((result) => result.outcome === "skipped").length;

  return {
    failed,
    passed,
    skipped,
    total: results.length,
  };
}

function getOverallOutcome(counts: {
  failed: number;
  passed: number;
  skipped: number;
}): ValidationGateOutcome {
  if (counts.failed > 0) {
    return "fail";
  }

  if (counts.passed > 0) {
    return "pass";
  }

  return "skipped";
}

async function runValidationGate(input: {
  cwd: string;
  executor: ValidationCommandExecutor;
  gate: ValidationGate;
  maxOutputBytes: number;
  now: () => Date;
  outputWriter?: ValidationOutputWriter;
  shouldSkipGate?: (gate: ValidationGate) => ValidationGateSkipDecision;
  timeoutMs: number;
}): Promise<ValidationGateResultV1> {
  const skipReason = normalizeSkipReason(input.shouldSkipGate?.(input.gate));
  if (skipReason) {
    return {
      command: input.gate.command,
      durationMs: 0,
      exitCode: null,
      key: input.gate.key,
      name: input.gate.name,
      outcome: "skipped",
      phase: input.gate.phase,
      produces: input.gate.produces,
      required: input.gate.required,
      skipReason,
    };
  }

  const command = evaluateValidationCommand(input.gate.command);
  if (!command.allowed) {
    return {
      command: input.gate.command,
      durationMs: 0,
      exitCode: 126,
      key: input.gate.key,
      message: command.reason,
      name: input.gate.name,
      outcome: "fail",
      phase: input.gate.phase,
      produces: input.gate.produces,
      required: input.gate.required,
    };
  }

  const startedAt = input.now();
  const result = await input.executor({
    args: command.args,
    command: input.gate.command,
    cwd: input.cwd,
    file: command.file,
    gate: input.gate,
    maxOutputBytes: input.maxOutputBytes,
    timeoutMs: input.timeoutMs,
  });
  const completedAt = input.now();
  const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 1;
  const output = await createOutputReference({
    command: input.gate.command,
    exitCode,
    gate: input.gate,
    outputWriter: input.outputWriter,
    stderr: result.stderr,
    stdout: result.stdout,
    truncated: result.truncated ?? false,
  });

  return {
    command: input.gate.command,
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    exitCode,
    key: input.gate.key,
    ...(result.timedOut ? { message: "Validation command timed out." } : {}),
    name: input.gate.name,
    outcome: exitCode === 0 ? "pass" : "fail",
    ...(output ? { output } : {}),
    phase: input.gate.phase,
    produces: input.gate.produces,
    required: input.gate.required,
  };
}

export async function executeValidationCommand(
  input: ValidationCommandExecutionInput,
): Promise<ValidationCommandExecutionResult> {
  return new Promise((resolve) => {
    execFile(
      input.file,
      input.args,
      {
        cwd: input.cwd,
        maxBuffer: input.maxOutputBytes,
        timeout: input.timeoutMs,
      },
      (error, stdout, stderr) => {
        const exitCode =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "number"
            ? error.code
            : error
              ? 1
              : 0;
        const timedOut =
          typeof error === "object" && error !== null && "killed" in error && error.killed === true;

        resolve({
          exitCode,
          stderr,
          stdout,
          ...(timedOut ? { timedOut: true } : {}),
          truncated: getOutputBytes(stdout) + getOutputBytes(stderr) >= input.maxOutputBytes,
        });
      },
    );
  });
}

export async function runValidationGates(
  input: RunValidationGatesInput,
): Promise<ValidationReportV1> {
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const executor = input.executor ?? executeValidationCommand;
  const results: ValidationGateResultV1[] = [];

  for (const gate of input.gates) {
    results.push(
      await runValidationGate({
        cwd: input.cwd ?? process.cwd(),
        executor,
        gate,
        maxOutputBytes: input.maxOutputBytes ?? defaultMaxOutputBytes,
        now,
        outputWriter: input.outputWriter,
        shouldSkipGate: input.shouldSkipGate,
        timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
      }),
    );
  }

  const counts = summarizeResults(results);

  return validationReportV1Schema.parse({
    counts,
    generatedAt,
    overallOutcome: getOverallOutcome(counts),
    results,
    schemaId: validationReportSchemaId,
    version: validationReportVersion,
  });
}

export async function runValidationWithScreenshotEvidence(
  input: RunValidationWithScreenshotEvidenceInput,
): Promise<{ report: ValidationReportV1; screenshotEvidence?: ScreenshotEvidence }> {
  const { screenshot, ...validation } = input;
  const report = await runValidationGates(validation);
  if (
    report.overallOutcome !== "pass" ||
    report.results.some(
      ({ outcome, required }) => outcome === "fail" || (required && outcome !== "pass"),
    )
  ) {
    return { report };
  }
  return {
    report,
    screenshotEvidence: await captureValidationScreenshots(screenshot),
  };
}
