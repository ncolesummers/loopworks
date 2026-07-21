import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { applyDevelopmentLoopValidationReviewResult } from "@/lib/loops/development-run-transitions";
import { computeScreenshotEvidenceDigest } from "@/lib/loops/screenshot-evidence";
import { logger } from "@/lib/observability/logger";
import { computeImplementationDigest } from "../implementation-agent";
import { resolveValidationReviewerFixtureMode } from "../subagents/validation-reviewer/lib/fixture-mode";
import { computeTestPlanDigest } from "../test-writing-agent";
import {
  computeValidationReviewDigest,
  validationReviewResultSchema,
} from "../validation-review-agent";
import { createValidationReviewFixtureContext } from "../validation-review-fixture";

export default defineTool({
  description:
    "Persist a bound validation review result and atomically route the durable run through the root control plane.",
  inputSchema: z.object({ runId: z.string().uuid(), output: validationReviewResultSchema }),
  execute: ({ output, runId }) => {
    const parsed = validationReviewResultSchema.parse(output);
    if (resolveValidationReviewerFixtureMode().enabled) {
      const context = createValidationReviewFixtureContext();
      const expectedBinding = {
        runId: context.run.id,
        reviewAttempt: context.reviewStep.attempt,
        planId: context.plan.identity.id,
        planSha256: context.plan.identity.sha256,
        testPlanSha256: computeTestPlanDigest(context.testPlan),
        implementationResultSha256: computeImplementationDigest(context.implementationResult),
        productionPatchSha256: context.implementationResult.patch.sha256,
        validationReportSha256: computeValidationReviewDigest(context.validationReport),
        screenshotEvidenceSha256: computeScreenshotEvidenceDigest(context.screenshotEvidence),
        repositoryFullName: context.plan.issue.repositoryFullName,
        commitSha: context.plan.repositoryRevision?.commitSha,
      };
      if (
        runId !== context.run.id ||
        computeValidationReviewDigest(parsed.binding) !==
          computeValidationReviewDigest(expectedBinding)
      ) {
        throw new Error("Fixture validation review is not bound to the exact handoff.");
      }
      const expectedEvidence = {
        validationResults: context.validationReport.results.map(
          ({ key, command, outcome, output }) => ({
            key,
            command,
            outcome,
            ...(output?.sha256 ? { outputSha256: output.sha256 } : {}),
          }),
        ),
        screenshots: context.screenshotEvidence.captures.map(
          ({ id, testId, viewport, width, height, uri, sha256 }) => ({
            id,
            testId,
            viewport,
            width,
            height,
            uri,
            sha256,
          }),
        ),
      };
      if (
        computeValidationReviewDigest(parsed.evidence) !==
        computeValidationReviewDigest(expectedEvidence)
      ) {
        throw new Error("Fixture validation review citations do not match the exact handoff.");
      }
      return {
        route: parsed.recommendation.route,
        runId,
        stage: "code-review" as const,
        status:
          parsed.recommendation.route === "commit" ? ("advanced" as const) : ("requeued" as const),
        stepId: context.reviewStep.id,
      };
    }
    return applyDevelopmentLoopValidationReviewResult({
      database: db,
      logger,
      output: parsed,
      runId,
    });
  },
});
