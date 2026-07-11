import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJsonStringify } from "../../../lib/canonical-json";
import {
  isAllowedFocusedTestCommand,
  isAllowedTestArtifactPath,
} from "../../../test-writing-agent";

export type PlannedTestCommand = {
  path: string;
  type: "unit" | "integration" | "browser";
};

export type TestExecutionReceiptPayload = {
  command: string;
  exitCode: number;
  expectedAssertions: string[];
  outcome: "expected_failure" | "invalid_failure";
  outputSha256: string;
  patchSha256: string;
  testPaths: string[];
};

export function assertAllowedTestFiles(files: readonly { path: string }[]): void {
  if (files.length === 0) throw new Error("At least one test file is required.");
  for (const file of files) {
    if (!isAllowedTestArtifactPath(file.path)) {
      throw new Error(`Unsafe test artifact path: ${file.path}`);
    }
  }
}

export function assertCommandMatchesPlannedTests(
  command: string,
  tests: readonly PlannedTestCommand[],
): void {
  assertAllowedTestFiles(tests);
  if (!isAllowedFocusedTestCommand(command) || tests.length === 0) {
    throw new Error("Command is not an allowed focused test command.");
  }
  const browser = tests.every((test) => test.type === "browser");
  const nonBrowser = tests.every((test) => test.type !== "browser");
  if (!browser && !nonBrowser)
    throw new Error("Browser and non-browser tests must run separately.");
  if (tests.length !== 1) throw new Error("Each focused red command must target exactly one test.");
  const prefix = browser ? "bunx playwright test" : "bun run test --";
  const expected = `${prefix} ${tests.map((test) => test.path).join(" ")}`;
  if (command.trim().replace(/\s+/g, " ") !== expected) {
    throw new Error("Command must exactly match the approved test paths.");
  }
}

export function redactTestOutput(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(
      /((?:password|secret|token|api[_-]?key|cookie|set-cookie)\s*[=:]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

export function classifyTestRun(input: {
  exitCode: number;
  expectedAssertions: readonly string[];
  output: string;
  testPaths: readonly string[];
}): "expected_failure" | "invalid_failure" {
  const infrastructureFailure =
    /(cannot find module|module not found|failed to load|command not found|no tests? found|syntaxerror|timed? out|timeout|killed|segmentation fault|out of memory|unhandled error)/i.test(
      input.output,
    );
  const assertionsMatched = input.expectedAssertions.every((assertion) =>
    input.output.includes(assertion),
  );
  const pathsMatched = input.testPaths.every((path) => input.output.includes(path));
  return input.exitCode > 0 && assertionsMatched && pathsMatched && !infrastructureFailure
    ? "expected_failure"
    : "invalid_failure";
}

export function createTestExecutionReceipt(
  payload: TestExecutionReceiptPayload,
  secret: string,
): string {
  if (!secret.trim()) throw new Error("Test execution receipt secret is required.");
  return createHmac("sha256", secret).update(canonicalJsonStringify(payload)).digest("hex");
}

export function verifyTestExecutionReceipt(
  payload: TestExecutionReceiptPayload,
  receipt: string,
  secret: string,
): boolean {
  const expected = Buffer.from(createTestExecutionReceipt(payload, secret), "hex");
  const actual = Buffer.from(receipt, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
