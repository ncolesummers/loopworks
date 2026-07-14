import { SpanStatusCode } from "@opentelemetry/api";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { computeScreenshotEvidenceDigest } from "@/lib/loops/screenshot-evidence";
import { startLoopworksSpan } from "@/lib/observability/trace-context";
import { computeImplementationDigest } from "../../../implementation-agent";
import { computeTestPlanDigest } from "../../../test-writing-agent";
import { computeValidationReviewDigest } from "../../../validation-review-agent";
import { loadValidationReviewContext } from "../lib/context";
import { resolveValidationReviewerFixtureMode } from "../lib/fixture-mode";

export default defineTool({
  description: "Load the exact passing validation-review handoff and prepare its pinned checkout.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }, ctx) {
    const review = await loadValidationReviewContext(runId);
    const revision = review.plan.repositoryRevision;
    if (!revision) throw new Error("Validation review requires a pinned revision.");
    const sandbox = await ctx.getSandbox();
    if (!resolveValidationReviewerFixtureMode().enabled) {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(review.plan.issue.repositoryFullName)) {
        throw new Error("Repository name is invalid.");
      }
      const repoUrl = `https://github.com/${review.plan.issue.repositoryFullName}.git`;
      const span = startLoopworksSpan("loopworks.validation_review.checkout", {
        attributes: { "loopworks.agent": "validation-reviewer", "loopworks.stage": "code-review" },
      });
      try {
        await sandbox.setNetworkPolicy({ allow: ["github.com", "objects.githubusercontent.com"] });
        const result = await sandbox.run({
          command: [
            `git clone --filter=blob:none ${JSON.stringify(repoUrl)} repo`,
            "cd repo",
            `git checkout --detach ${revision.commitSha}`,
            'test -z "$(git status --porcelain)"',
          ].join(" && "),
          abortSignal: AbortSignal.timeout(120_000),
        });
        if (result.exitCode !== 0) throw new Error("Commit-pinned review checkout failed.");
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        await sandbox.setNetworkPolicy("deny-all");
        span.end();
      }
    }
    await sandbox.run({ command: "mkdir -p .loopworks" });
    await sandbox.writeTextFile({
      path: ".loopworks/repository-commit",
      content: revision.commitSha,
    });
    return {
      runId,
      reviewAttempt: review.reviewStep.attempt,
      acceptanceCriteria: review.testPlan.acceptanceCriteria,
      binding: {
        planId: review.plan.identity.id,
        planSha256: review.plan.identity.sha256,
        testPlanSha256: computeTestPlanDigest(review.testPlan),
        implementationResultSha256: computeImplementationDigest(review.implementationResult),
        productionPatchSha256: review.implementationResult.patch.sha256,
        validationReportSha256: computeValidationReviewDigest(review.validationReport),
        screenshotEvidenceSha256: computeScreenshotEvidenceDigest(review.screenshotEvidence),
        repositoryFullName: review.plan.issue.repositoryFullName,
        commitSha: revision.commitSha,
      },
    };
  },
});
