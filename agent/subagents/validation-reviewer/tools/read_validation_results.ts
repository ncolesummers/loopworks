import { defineTool } from "eve/tools";
import { z } from "zod";

import { computeValidationReviewDigest } from "../../../validation-review-agent";
import { loadValidationReviewContext } from "../lib/context";

const validationReviewEvidenceOutputSchema = z
  .object({
    schemaId: z.literal("loopworks.validation_review_validation_evidence.v1"),
    binding: z
      .object({
        runId: z.string().uuid(),
        reviewAttempt: z.number().int().positive(),
        validationReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    overallOutcome: z.literal("pass"),
    results: z.array(
      z
        .object({
          key: z.string().min(1),
          command: z.string().min(1),
          outcome: z.literal("pass"),
          outputSha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

export default defineTool({
  description: "Read bound typed deterministic validation results without raw command output.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  outputSchema: validationReviewEvidenceOutputSchema,
  async execute({ runId }) {
    const review = await loadValidationReviewContext(runId);
    return validationReviewEvidenceOutputSchema.parse({
      schemaId: "loopworks.validation_review_validation_evidence.v1",
      binding: {
        runId,
        reviewAttempt: review.reviewStep.attempt,
        validationReportSha256: computeValidationReviewDigest(review.validationReport),
      },
      overallOutcome: review.validationReport.overallOutcome,
      results: review.validationReport.results.map(({ key, command, outcome, output }) => ({
        key,
        command,
        outcome,
        ...(output?.sha256 ? { outputSha256: output.sha256 } : {}),
      })),
    });
  },
});
