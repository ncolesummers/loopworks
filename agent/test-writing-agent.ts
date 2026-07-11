import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJsonStringify } from "./lib/canonical-json";

export const testWriterModelLabel = "openai/gpt-5.6-terra-xhigh";
export const testPlanSchemaId = "loopworks.test_plan.v1";
export const redTestEvidenceSchemaId = "loopworks.red_test_evidence.v1";
export const maxTestPatchBytes = 256 * 1024;

export function computeTestPlanDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

const safeTestPathPattern =
  /(^|\/)(tests?|evals?|fixtures?|stories)(\/|$)|\.(test|spec|stories)\.[^/]+$/;

export function isAllowedTestArtifactPath(path: string): boolean {
  const normalized = path.trim().replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.includes("//") &&
    !/[;&|`$<>\n\r\0]/.test(normalized) &&
    !normalized.split("/").includes(".") &&
    !normalized.split("/").includes("..") &&
    !normalized.startsWith(".git/") &&
    safeTestPathPattern.test(normalized)
  );
}

export function isAllowedFocusedTestCommand(command: string): boolean {
  if (/[;&|`$<>\n\r]/.test(command)) return false;
  const normalized = command.trim().replace(/\s+/g, " ");
  return /^(bun run test --|bunx playwright test)(\s+[^-\s][^\s]*)+$/.test(normalized);
}

function duplicateIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function containsSecretLikeFixtureData(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => {
    const secretKey = /(password|passwd|secret|token|api[_-]?key|private[_-]?key)/i.test(key);
    const secretValue =
      typeof entry === "string" && /(bearer\s+|gh[pousr]_|sk-[a-z0-9])/i.test(entry);
    return secretKey || secretValue;
  });
}

function patchHeaderPaths(content: string): string[] {
  const paths = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      if (diffMatch[1]) paths.add(diffMatch[1]);
      if (diffMatch[2]) paths.add(diffMatch[2]);
      continue;
    }
    const headerMatch = line.match(/^(?:---|\+\+\+) (?:[ab]\/(.+)|\/dev\/null)$/);
    if (headerMatch?.[1]) paths.add(headerMatch[1]);
  }
  return [...paths];
}

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

export const testPlanArtifactSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(testPlanSchemaId),
    plan: z.object({
      id: z.string().min(1),
      sha256: sha256Schema,
      repositoryFullName: z.string().min(1),
      commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    }),
    acceptanceCriteria: z
      .array(z.object({ id: identifierSchema, text: z.string().min(1) }).strict())
      .min(1),
    tests: z
      .array(
        z
          .object({
            id: identifierSchema,
            acceptanceCriterionIds: z.array(identifierSchema).min(1),
            type: z.enum(["unit", "integration", "browser"]),
            path: z.string().refine(isAllowedTestArtifactPath, "Unsafe test artifact path."),
            command: z.string().refine(isAllowedFocusedTestCommand, "Unsafe focused test command."),
            steps: z.array(z.string().min(1)).min(1),
            expectedFailure: z.object({ kind: z.literal("assertion"), message: z.string().min(1) }),
            fixtureIds: z.array(identifierSchema).default([]),
          })
          .strict(),
      )
      .min(1),
    fixtures: z.array(
      z
        .object({
          id: identifierSchema,
          kind: z.enum(["fixture", "seed"]),
          description: z.string().min(1),
          data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        })
        .strict(),
    ),
    patch: z
      .object({
        format: z.literal("unified-diff"),
        content: z.string().min(1),
        sha256: sha256Schema,
        byteCount: z.number().int().positive().max(maxTestPatchBytes),
        paths: z.array(z.string().refine(isAllowedTestArtifactPath)).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const criterionIds = new Set(artifact.acceptanceCriteria.map((criterion) => criterion.id));
    const fixtureIds = new Set(artifact.fixtures.map((fixture) => fixture.id));
    const coveredCriteria = new Set<string>();
    for (const duplicate of duplicateIds(artifact.acceptanceCriteria.map(({ id }) => id))) {
      ctx.addIssue({ code: "custom", message: `Duplicate acceptance criterion ${duplicate}.` });
    }
    for (const duplicate of duplicateIds(artifact.tests.map(({ id }) => id))) {
      ctx.addIssue({ code: "custom", message: `Duplicate test ${duplicate}.` });
    }
    for (const duplicate of duplicateIds(artifact.fixtures.map(({ id }) => id))) {
      ctx.addIssue({ code: "custom", message: `Duplicate fixture ${duplicate}.` });
    }
    for (const test of artifact.tests) {
      for (const criterionId of test.acceptanceCriterionIds) {
        if (!criterionIds.has(criterionId)) {
          ctx.addIssue({ code: "custom", message: `Unknown acceptance criterion ${criterionId}.` });
        }
        coveredCriteria.add(criterionId);
      }
      for (const fixtureId of test.fixtureIds) {
        if (!fixtureIds.has(fixtureId)) {
          ctx.addIssue({ code: "custom", message: `Unknown fixture ${fixtureId}.` });
        }
      }
    }
    for (const criterionId of criterionIds) {
      if (!coveredCriteria.has(criterionId)) {
        ctx.addIssue({
          code: "custom",
          message: `Acceptance criterion ${criterionId} is uncovered.`,
        });
      }
    }
    if (artifact.fixtures.some((fixture) => containsSecretLikeFixtureData(fixture.data))) {
      ctx.addIssue({ code: "custom", message: "Artifact contains secret-like fixture data." });
    }
    const declaredPaths = new Set(artifact.patch.paths);
    const parsedPatchPaths = patchHeaderPaths(artifact.patch.content);
    if (parsedPatchPaths.length === 0) {
      ctx.addIssue({ code: "custom", message: "Patch must contain a parseable diff header." });
    }
    if (
      /^(?:rename|copy) (?:from|to) |^GIT binary patch$|^(?:new file mode|old mode|new mode) 120000$/m.test(
        artifact.patch.content,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Patch contains a forbidden link, rename, copy, or binary operation.",
      });
    }
    for (const path of parsedPatchPaths) {
      if (!declaredPaths.has(path) || !isAllowedTestArtifactPath(path)) {
        ctx.addIssue({
          code: "custom",
          message: `Patch contains undeclared or unsafe path ${path}.`,
        });
      }
    }
    for (const path of declaredPaths) {
      if (!parsedPatchPaths.includes(path)) {
        ctx.addIssue({
          code: "custom",
          message: `Declared patch path ${path} is missing from diff headers.`,
        });
      }
    }
    const bytes = Buffer.byteLength(artifact.patch.content, "utf8");
    if (bytes !== artifact.patch.byteCount) {
      ctx.addIssue({ code: "custom", message: "Patch byte count does not match content." });
    }
    if (
      createHash("sha256").update(artifact.patch.content).digest("hex") !== artifact.patch.sha256
    ) {
      ctx.addIssue({ code: "custom", message: "Patch digest does not match content." });
    }
  });

export const redTestEvidenceSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(redTestEvidenceSchemaId),
    planId: z.string().min(1),
    planSha256: sha256Schema,
    testPlanSha256: sha256Schema,
    results: z
      .array(
        z
          .object({
            id: identifierSchema,
            testId: identifierSchema,
            acceptanceCriterionIds: z.array(identifierSchema).min(1),
            command: z.string().refine(isAllowedFocusedTestCommand),
            outcome: z.literal("expected_failure"),
            exitCode: z.number().int().positive(),
            durationMs: z.number().int().nonnegative(),
            expectedAssertion: z.string().min(1),
            executionReceipt: sha256Schema,
            outputReference: z.object({
              uri: z.string().min(1),
              sha256: sha256Schema,
              byteCount: z.number().int().nonnegative(),
              redacted: z.literal(true),
            }),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const testWritingAgentOutputSchema = z
  .object({
    model: z.literal(testWriterModelLabel),
    testPlan: testPlanArtifactSchema,
    redEvidence: redTestEvidenceSchema,
  })
  .strict()
  .superRefine((output, ctx) => {
    const criterionIds = new Set(
      output.testPlan.acceptanceCriteria.map((criterion) => criterion.id),
    );
    const testIds = new Set(output.testPlan.tests.map((test) => test.id));
    const evidenceTestIds = new Set(output.redEvidence.results.map((result) => result.testId));
    if (
      output.redEvidence.planId !== output.testPlan.plan.id ||
      output.redEvidence.planSha256 !== output.testPlan.plan.sha256
    ) {
      ctx.addIssue({ code: "custom", message: "Red evidence is not bound to the test plan." });
    }
    if (output.redEvidence.testPlanSha256 !== computeTestPlanDigest(output.testPlan)) {
      ctx.addIssue({ code: "custom", message: "Red evidence test-plan digest does not match." });
    }
    for (const duplicate of duplicateIds(output.redEvidence.results.map(({ id }) => id))) {
      ctx.addIssue({ code: "custom", message: `Duplicate red evidence ${duplicate}.` });
    }
    for (const result of output.redEvidence.results) {
      if (!testIds.has(result.testId)) {
        ctx.addIssue({
          code: "custom",
          message: `Red evidence references unknown test ${result.testId}.`,
        });
      }
      for (const criterionId of result.acceptanceCriterionIds) {
        if (!criterionIds.has(criterionId)) {
          ctx.addIssue({
            code: "custom",
            message: `Red evidence references unknown acceptance criterion ${criterionId}.`,
          });
        }
      }
      const plannedTest = output.testPlan.tests.find((test) => test.id === result.testId);
      if (
        plannedTest &&
        (result.command !== plannedTest.command ||
          result.expectedAssertion !== plannedTest.expectedFailure.message ||
          JSON.stringify(result.acceptanceCriterionIds) !==
            JSON.stringify(plannedTest.acceptanceCriterionIds))
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Red evidence does not exactly match planned test ${result.testId}.`,
        });
      }
    }
    for (const duplicate of duplicateIds(output.redEvidence.results.map(({ testId }) => testId))) {
      ctx.addIssue({ code: "custom", message: `Duplicate evidence for test ${duplicate}.` });
    }
    const plannedPaths = new Set(output.testPlan.tests.map((test) => test.path));
    const patchPaths = new Set(output.testPlan.patch.paths);
    if (
      plannedPaths.size !== patchPaths.size ||
      [...plannedPaths].some((path) => !patchPaths.has(path))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Patch paths must exactly match planned test paths.",
      });
    }
    for (const testId of testIds) {
      if (!evidenceTestIds.has(testId)) {
        ctx.addIssue({ code: "custom", message: `Test ${testId} has no red evidence.` });
      }
    }
  });

export type TestWritingAgentOutput = z.infer<typeof testWritingAgentOutputSchema>;

export function createRedTestEvidenceArtifactContractMetadata() {
  return {
    expectedRedTestEvidenceSchemaId: redTestEvidenceSchemaId,
    redTestEvidenceMetadataKind: "red_test_evidence_contract" as const,
    redTestEvidenceVersion: 1 as const,
  };
}

export function createTestPlanArtifactContractMetadata() {
  return {
    expectedTestPlanSchemaId: testPlanSchemaId,
    testPlanMetadataKind: "test_plan_contract" as const,
    testPlanVersion: 1 as const,
  };
}
