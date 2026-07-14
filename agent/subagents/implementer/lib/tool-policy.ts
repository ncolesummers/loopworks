import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJsonStringify } from "../../../lib/canonical-json";
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

export function classifyGreenRun(input: {
  exitCode: number;
  output: string;
  testPath: string;
}): "pass" | "invalid" {
  const invalidOutput =
    /(no tests? found|no test files found|cannot find module|module not found|failed to load|command not found|syntaxerror|timed? out|timeout|killed|segmentation fault|out of memory|unhandled error)/i.test(
      input.output,
    );
  return input.exitCode === 0 && input.output.includes(input.testPath) && !invalidOutput
    ? "pass"
    : "invalid";
}

export function redactImplementationOutput(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:gh[pousr]_|sk-)[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /((?:password|secret|token|api[_-]?key|cookie|set-cookie)\s*[=:]\s*)\S+/gi,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

export function createImplementationExecutionReceipt(
  payload: ImplementationExecutionReceiptPayload,
  secret: string,
): string {
  if (!secret.trim()) throw new Error("Implementation receipt secret is required.");
  return createHmac("sha256", secret).update(canonicalJsonStringify(payload)).digest("hex");
}

export function verifyImplementationExecutionReceipt(
  payload: ImplementationExecutionReceiptPayload,
  receipt: string,
  secret: string,
): boolean {
  const expected = Buffer.from(createImplementationExecutionReceipt(payload, secret), "hex");
  const actual = Buffer.from(receipt, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
