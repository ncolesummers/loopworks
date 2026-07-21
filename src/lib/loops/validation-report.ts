import { z } from "zod";

import type { LoopDefinition } from "../../../schemas/loop-manifest";

export const validationReportVersion = 1;
export const validationReportSchemaId = "loopworks.validation_report.v1";
export const validationGateOutcomeValues = ["pass", "fail", "skipped"] as const;

export const validationOutputReferenceSchema = z
  .object({
    stderrBytes: z.number().int().min(0),
    stdoutBytes: z.number().int().min(0),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    truncated: z.boolean(),
    uri: z.string().min(1),
  })
  .strict();

export const validationGateResultV1Schema = z
  .object({
    command: z.string().min(1),
    durationMs: z.number().int().min(0),
    exitCode: z.number().int().nullable(),
    key: z.string().min(1),
    message: z.string().min(1).optional(),
    name: z.string().min(1),
    outcome: z.enum(validationGateOutcomeValues),
    output: validationOutputReferenceSchema.optional(),
    phase: z.string().min(1),
    produces: z.string().min(1),
    required: z.boolean(),
    skipReason: z.string().min(1).optional(),
  })
  .strict();

export const validationReportV1Schema = z
  .object({
    counts: z
      .object({
        failed: z.number().int().min(0),
        passed: z.number().int().min(0),
        skipped: z.number().int().min(0),
        total: z.number().int().min(0),
      })
      .strict(),
    generatedAt: z.string().datetime(),
    overallOutcome: z.enum(validationGateOutcomeValues),
    results: z.array(validationGateResultV1Schema),
    schemaId: z.literal(validationReportSchemaId),
    version: z.literal(validationReportVersion),
  })
  .strict()
  .superRefine((report, context) => {
    const counts = {
      failed: report.results.filter((result) => result.outcome === "fail").length,
      passed: report.results.filter((result) => result.outcome === "pass").length,
      skipped: report.results.filter((result) => result.outcome === "skipped").length,
      total: report.results.length,
    };
    const expectedOverallOutcome =
      counts.failed > 0 ? "fail" : counts.passed > 0 ? "pass" : "skipped";
    const seenKeys = new Set<string>();

    for (const [index, result] of report.results.entries()) {
      if (seenKeys.has(result.key)) {
        context.addIssue({
          code: "custom",
          message: "validation result keys must be unique.",
          path: ["results", index, "key"],
        });
      }
      seenKeys.add(result.key);
      if (result.outcome === "pass" && result.exitCode !== 0) {
        context.addIssue({
          code: "custom",
          message: "passing validation requires exitCode 0.",
          path: ["results", index, "exitCode"],
        });
      }
      if (result.outcome === "fail" && (result.exitCode === null || result.exitCode === 0)) {
        context.addIssue({
          code: "custom",
          message: "failed validation requires a non-zero exitCode.",
          path: ["results", index, "exitCode"],
        });
      }
      if (result.outcome === "skipped" && (result.exitCode !== null || !result.skipReason)) {
        context.addIssue({
          code: "custom",
          message: "skipped validation requires null exitCode and skipReason.",
          path: ["results", index],
        });
      }
    }

    for (const key of ["failed", "passed", "skipped", "total"] as const) {
      if (report.counts[key] !== counts[key]) {
        context.addIssue({
          code: "custom",
          message: `counts.${key} must match validation results.`,
          path: ["counts", key],
        });
      }
    }

    if (report.overallOutcome !== expectedOverallOutcome) {
      context.addIssue({
        code: "custom",
        message: "overallOutcome must match validation result precedence.",
        path: ["overallOutcome"],
      });
    }
  });

export const validationReportArtifactContractMetadataSchema = z
  .object({
    detail: z.string().min(1).optional(),
    expectedValidationReportSchemaId: z.literal(validationReportSchemaId),
    validationReportMetadataKind: z.literal("validation_report_contract"),
    validationReportVersion: z.literal(validationReportVersion),
  })
  .strict();

export const validationReportArtifactMetadataSchema = z
  .object({
    detail: z.string().min(1),
    validationReport: validationReportV1Schema,
    validationReportMetadataKind: z.literal("validation_report_result"),
    validationReportSchemaId: z.literal(validationReportSchemaId),
    validationReportVersion: z.literal(validationReportVersion),
  })
  .strict();

export type ValidationGate = LoopDefinition["validationGates"][number];
export type ValidationGateOutcome = (typeof validationGateOutcomeValues)[number];
export type ValidationOutputReference = z.infer<typeof validationOutputReferenceSchema>;
export type ValidationGateResultV1 = z.infer<typeof validationGateResultV1Schema>;
export type ValidationReportV1 = z.infer<typeof validationReportV1Schema>;
export type ValidationReportArtifactMetadata = z.infer<
  typeof validationReportArtifactMetadataSchema
>;
export type ValidationReportArtifactContractMetadata = z.infer<
  typeof validationReportArtifactContractMetadataSchema
>;

export function summarizeValidationReport(report: ValidationReportV1): string {
  return `Validation report: ${report.counts.passed} passed, ${report.counts.failed} failed, ${report.counts.skipped} skipped.`;
}

export function createValidationReportArtifactContractMetadata(input?: {
  detail?: string;
}): ValidationReportArtifactContractMetadata {
  return validationReportArtifactContractMetadataSchema.parse({
    ...(input?.detail ? { detail: input.detail } : {}),
    expectedValidationReportSchemaId: validationReportSchemaId,
    validationReportMetadataKind: "validation_report_contract",
    validationReportVersion,
  });
}

export function createValidationReportArtifactMetadata(
  report: ValidationReportV1,
): ValidationReportArtifactMetadata {
  return validationReportArtifactMetadataSchema.parse({
    detail: summarizeValidationReport(report),
    validationReport: report,
    validationReportMetadataKind: "validation_report_result",
    validationReportSchemaId,
    validationReportVersion,
  });
}
