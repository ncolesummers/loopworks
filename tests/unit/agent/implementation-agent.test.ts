/** @vitest-environment node */
import { createHash } from "node:crypto";

import {
  computeImplementationDigest,
  implementationAgentModelLabel,
  implementationResultSchema,
  implementationResultSchemaId,
  isAllowedProductionArtifactPath,
} from "@agent/implementation-agent";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const productionPatch = [
  "diff --git a/src/example.ts b/src/example.ts",
  "--- a/src/example.ts",
  "+++ b/src/example.ts",
  "@@ -1 +1 @@",
  "-export const ready = false;",
  "+export const ready = true;",
].join("\n");

function validResult() {
  return {
    version: 1 as const,
    schemaId: implementationResultSchemaId,
    model: implementationAgentModelLabel,
    binding: {
      planId: "plan-48",
      planSha256: "a".repeat(64),
      testPlanSha256: "b".repeat(64),
      testPatchSha256: "c".repeat(64),
      fixturesSha256: "d".repeat(64),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "e".repeat(40),
    },
    patch: {
      format: "unified-diff" as const,
      content: productionPatch,
      sha256: sha256(productionPatch),
      byteCount: Buffer.byteLength(productionPatch),
      paths: ["src/example.ts"],
    },
    greenEvidence: [
      {
        id: "green-ac-1",
        testId: "test-ac-1",
        acceptanceCriterionIds: ["ac-1"],
        command: "bun run test -- tests/unit/example.test.ts",
        testPath: "tests/unit/example.test.ts",
        outcome: "pass" as const,
        exitCode: 0 as const,
        durationMs: 10,
        executionReceipt: "f".repeat(64),
        outputReference: {
          uri: "artifact://sandbox/green.log",
          sha256: "1".repeat(64),
          byteCount: 12,
          redacted: true as const,
        },
      },
    ],
    validationEvidence: {
      command: "bun run validate" as const,
      outcome: "pass" as const,
      exitCode: 0 as const,
      durationMs: 20,
      executionReceipt: "2".repeat(64),
      outputReference: {
        uri: "artifact://sandbox/validate.log",
        sha256: "3".repeat(64),
        byteCount: 15,
        redacted: true as const,
      },
    },
  };
}

describe("implementation result contract", () => {
  it("accepts a digest-bound production patch with focused and aggregate green evidence", () => {
    expect(implementationResultSchema.parse(validResult())).toMatchObject({
      schemaId: "loopworks.implementation_result.v1",
      model: "openai/gpt-5.6-terra-xhigh",
      validationEvidence: { command: "bun run validate", outcome: "pass" },
    });
    expect(computeImplementationDigest(validResult())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects test artifacts, unsafe patch operations, and digest mismatches", () => {
    expect(isAllowedProductionArtifactPath("src/lib/runtime.ts")).toBe(true);
    expect(isAllowedProductionArtifactPath("tests/unit/runtime.test.ts")).toBe(false);
    expect(isAllowedProductionArtifactPath("src/lib/runtime.test.ts")).toBe(false);
    expect(isAllowedProductionArtifactPath("../src/lib/runtime.ts")).toBe(false);

    const unsafe = validResult();
    unsafe.patch.content = `${unsafe.patch.content}\nrename from src/example.ts`;
    unsafe.patch.byteCount = Buffer.byteLength(unsafe.patch.content);
    unsafe.patch.sha256 = sha256(unsafe.patch.content);
    expect(implementationResultSchema.safeParse(unsafe).success).toBe(false);

    const badDigest = validResult();
    badDigest.patch.sha256 = "0".repeat(64);
    expect(implementationResultSchema.safeParse(badDigest).success).toBe(false);
  });

  it("rejects duplicate or incomplete green evidence", () => {
    const duplicate = validResult();
    duplicate.greenEvidence.push({ ...duplicate.greenEvidence[0] });
    expect(implementationResultSchema.safeParse(duplicate).success).toBe(false);

    const empty = validResult();
    empty.greenEvidence = [];
    expect(implementationResultSchema.safeParse(empty).success).toBe(false);
  });
});
