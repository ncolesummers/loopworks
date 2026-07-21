import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJsonStringify } from "./lib/canonical-json";
import { screenshotArtifactUriSchema } from "./lib/screenshot-artifact-uri";

export const validationReviewAgentModelLabel = "openai/gpt-5.6-terra-xhigh";
export const validationReviewResultSchemaId = "loopworks.validation_review_result.v1";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const identifierSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const safeTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) =>
      !/(?:authorization\s*:|bearer\s+|password\s*[:=]|token\s*[:=]|secret\s*[:=]|gh[pousr]_|sk-[a-z0-9]|-----BEGIN|data:image\/|raw (?:stdout|stderr|prompt))/i.test(
        value,
      ),
    "Review narrative contains forbidden secret-like or raw evidence content.",
  );
const safePathSchema = z.string().refine((value) => {
  const path = value.replaceAll("\\", "/");
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:\//.test(path) &&
    !path.includes("//") &&
    !path.split("/").some((segment) => segment === "." || segment === "..") &&
    !/[;&|`$<>\n\r\0]/.test(path)
  );
}, "Unsafe repository path.");

const validationEvidenceSchema = z
  .object({
    key: z.string().min(1).max(160),
    command: z.string().min(1).max(500),
    outcome: z.literal("pass"),
    outputSha256: sha256Schema.optional(),
  })
  .strict();
const screenshotCitationSchema = z
  .object({
    id: identifierSchema,
    testId: identifierSchema,
    viewport: z.enum(["mobile", "laptop", "desktop"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    uri: screenshotArtifactUriSchema,
    sha256: sha256Schema,
  })
  .strict();

const citationSetSchema = z.object({
  validationCitationKeys: z.array(z.string().min(1)).min(1),
  screenshotCitationIds: z.array(identifierSchema),
});

export const validationReviewResultSchema = z
  .object({
    version: z.literal(1),
    schemaId: z.literal(validationReviewResultSchemaId),
    model: z.literal(validationReviewAgentModelLabel),
    binding: z
      .object({
        runId: z.string().uuid(),
        reviewAttempt: z.number().int().positive(),
        planId: z.string().min(1),
        planSha256: sha256Schema,
        testPlanSha256: sha256Schema,
        implementationResultSha256: sha256Schema,
        productionPatchSha256: sha256Schema,
        validationReportSha256: sha256Schema,
        screenshotEvidenceSha256: sha256Schema,
        repositoryFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    evidence: z
      .object({
        validationResults: z.array(validationEvidenceSchema).min(1),
        screenshots: z.array(screenshotCitationSchema),
      })
      .strict(),
    findings: z.array(
      citationSetSchema
        .extend({
          id: identifierSchema,
          severity: z.enum(["blocker", "high", "medium", "low"]),
          category: z.enum([
            "implementation",
            "test-plan",
            "coverage",
            "fixture",
            "security",
            "accessibility",
            "responsive",
            "observability",
            "architecture",
          ]),
          summary: safeTextSchema,
          path: safePathSchema.optional(),
          line: z.number().int().positive().optional(),
        })
        .strict(),
    ),
    recommendation: citationSetSchema
      .extend({
        route: z.enum(["commit", "development", "test-writing"]),
        reason: safeTextSchema,
        findingIds: z.array(identifierSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((result, context) => {
    const validationKeys = new Set(result.evidence.validationResults.map(({ key }) => key));
    const screenshotIds = new Set(result.evidence.screenshots.map(({ id }) => id));
    const findingIds = new Set(result.findings.map(({ id }) => id));
    if (validationKeys.size !== result.evidence.validationResults.length) {
      context.addIssue({ code: "custom", message: "Validation evidence keys must be unique." });
    }
    if (screenshotIds.size !== result.evidence.screenshots.length) {
      context.addIssue({ code: "custom", message: "Screenshot evidence ids must be unique." });
    }
    if (findingIds.size !== result.findings.length) {
      context.addIssue({ code: "custom", message: "Finding ids must be unique." });
    }

    const validateCitations = (input: {
      validationCitationKeys: string[];
      screenshotCitationIds: string[];
    }) => {
      if (new Set(input.validationCitationKeys).size !== input.validationCitationKeys.length) {
        context.addIssue({ code: "custom", message: "Validation citations must be unique." });
      }
      if (new Set(input.screenshotCitationIds).size !== input.screenshotCitationIds.length) {
        context.addIssue({ code: "custom", message: "Screenshot citations must be unique." });
      }
      for (const key of input.validationCitationKeys) {
        if (!validationKeys.has(key)) {
          context.addIssue({ code: "custom", message: `Unknown validation citation ${key}.` });
        }
      }
      for (const id of input.screenshotCitationIds) {
        if (!screenshotIds.has(id)) {
          context.addIssue({ code: "custom", message: `Unknown screenshot citation ${id}.` });
        }
      }
    };
    for (const finding of result.findings) {
      validateCitations(finding);
      if (
        ["accessibility", "responsive"].includes(finding.category) &&
        finding.screenshotCitationIds.length === 0
      ) {
        context.addIssue({
          code: "custom",
          message: `${finding.category} findings require a screenshot citation.`,
        });
      }
      if (finding.line && !finding.path) {
        context.addIssue({ code: "custom", message: "Finding line requires a repository path." });
      }
    }
    validateCitations(result.recommendation);
    if (
      new Set(result.recommendation.findingIds).size !== result.recommendation.findingIds.length
    ) {
      context.addIssue({ code: "custom", message: "Recommendation finding ids must be unique." });
    }
    for (const id of result.recommendation.findingIds) {
      if (!findingIds.has(id)) {
        context.addIssue({ code: "custom", message: `Unknown recommendation finding ${id}.` });
      }
    }
    if (result.recommendation.route !== "commit" && result.recommendation.findingIds.length === 0) {
      context.addIssue({ code: "custom", message: "Backward routing requires a cited finding." });
    }
    if (
      result.recommendation.route === "commit" &&
      result.findings.some(({ severity }) => severity === "blocker" || severity === "high")
    ) {
      context.addIssue({
        code: "custom",
        message: "Blocking or high findings cannot route to commit.",
      });
    }
  });

export type ValidationReviewResult = z.infer<typeof validationReviewResultSchema>;

export function computeValidationReviewDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

export function createValidationReviewArtifactContractMetadata() {
  return {
    expectedValidationReviewResultSchemaId: validationReviewResultSchemaId,
    validationReviewMetadataKind: "validation_review_contract" as const,
    validationReviewVersion: 1 as const,
  };
}
