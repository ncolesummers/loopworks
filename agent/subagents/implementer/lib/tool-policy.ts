import { createHash } from "node:crypto";

import { createExecutionReceipt, verifyExecutionReceipt } from "../../../lib/receipts";
import { redactSecrets } from "../../../lib/redaction";
import { isAllowedProductionArtifactPath } from "../../../implementation-agent";

export type ImplementationExecutionReceiptPayload = {
  kind: "focused" | "aggregate";
  command: string;
  exitCode: number;
  outcome: "pass" | "invalid";
  outputSha256: string;
  planSha256: string;
  testPlanSha256: string;
  testPatchSha256: string;
  productionPatchSha256: string;
  testPaths: string[];
};

export function assertAllowedProductionFiles(files: readonly { path: string }[]): void {
  if (files.length === 0) throw new Error("At least one production file is required.");
  for (const file of files) {
    if (!isAllowedProductionArtifactPath(file.path)) {
      throw new Error(`Unsafe production artifact path: ${file.path}`);
    }
  }
}

export function assertProductionWriteNotClaimed(existingClaim: string | null): void {
  if (existingClaim !== null) {
    throw new Error("Production files may be written only once per implementation session.");
  }
}

export function assertWellFormedRepositoryFullName(repositoryFullName: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName)) {
    throw new Error("Repository name must be a well-formed owner/name pair.");
  }
}

// `git diff --name-only` never lists untracked files, so freshly added files
// (the common shape of a test patch) would be invisible to path verification.
// --untracked-files=all keeps new directories from collapsing to "?? dir/".
export const sandboxWorkingTreeStatusCommand =
  "cd repo && git status --porcelain --untracked-files=all";

export function parseWorkingTreePaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((path) => {
      if (!path.startsWith('"') || !path.endsWith('"')) return path;
      try {
        // Porcelain C-quotes paths with spaces; JSON unquoting covers those.
        // Paths it cannot decode stay quoted and fail closed at comparison.
        return JSON.parse(path) as string;
      } catch {
        return path;
      }
    })
    .sort();
}

export function assertExactFocusedCommand(
  command: string,
  plannedCommand: string,
  testPath: string,
): void {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ");
  if (
    /[;&|`$<>\n\r]/.test(command) ||
    normalize(command) !== normalize(plannedCommand) ||
    !normalize(command).endsWith(` ${testPath}`)
  ) {
    throw new Error("Command must exactly match one planned focused test.");
  }
}

// Broad substrings like "timeout" or "killed" appear in legitimate test titles
// and misclassify green runs; a zero exit code already rules out crashes, so we
// require positive pass evidence and scan only for runner-level infra errors.
export function classifyGreenRun(input: {
  exitCode: number;
  output: string;
  testPath: string;
}): "pass" | "invalid" {
  const invalidOutput =
    /(no tests? found|no test files found|cannot find module|module not found|failed to load|command not found)/i.test(
      input.output,
    );
  const passEvidence = /\b[1-9]\d*\s+pass(?:ed|ing)?\b|\bPASS\b/.test(input.output);
  return input.exitCode === 0 &&
    input.output.includes(input.testPath) &&
    passEvidence &&
    !invalidOutput
    ? "pass"
    : "invalid";
}

export function redactImplementationOutput(value: string): string {
  return redactSecrets(value);
}

export function createImplementationExecutionReceipt(
  payload: ImplementationExecutionReceiptPayload,
  secret: string,
): string {
  if (!secret.trim()) throw new Error("Implementation receipt secret is required.");
  return createExecutionReceipt(payload, secret);
}

export function verifyImplementationExecutionReceipt(
  payload: ImplementationExecutionReceiptPayload,
  receipt: string,
  secret: string,
): boolean {
  return verifyExecutionReceipt(payload, receipt, secret);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
