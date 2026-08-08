import { randomUUID } from "node:crypto";
import {
  computeImplementationDigest,
  createImplementationArtifactContractMetadata,
  implementationResultSchema,
} from "@agent/implementation-agent";
import {
  computePlanningArtifactDigest,
  pinnedPlanningAgentOutputSchema,
} from "@agent/planning-agent";
import {
  computeTestPlanDigest,
  createRedTestEvidenceArtifactContractMetadata,
  createTestPlanArtifactContractMetadata,
  testPlanArtifactSchema,
} from "@agent/test-writing-agent";
import {
  computeValidationReviewDigest,
  createValidationReviewArtifactContractMetadata,
  type ValidationReviewResult,
  validationReviewResultSchema,
} from "@agent/validation-review-agent";
import { and, eq, sql } from "drizzle-orm";
import { agentPlans, approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import {
  assertScreenshotEvidenceBinding,
  assertScreenshotEvidenceCoverage,
  classifyUiAffectingChange,
  computeScreenshotEvidenceDigest,
  createScreenshotEvidenceArtifactContractMetadata,
  screenshotBrowserTests,
  screenshotEvidenceSchema,
} from "@/lib/loops/screenshot-evidence";
import {
  createValidationReportArtifactContractMetadata,
  validationReportArtifactMetadataSchema,
} from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import {
  type DevelopmentLoopStepRetryMetricInput,
  recordDevelopmentLoopStepDurationMetric,
  recordDevelopmentLoopStepRetryMetric,
} from "@/lib/observability/metrics";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";

import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  emitSafely,
  metadataWithoutBlockedReason,
  type RunMetadata,
  type ValidationReviewHistoryEntry,
  validationReviewHistory,
} from "./shared";

export type ValidationReviewTransitionResult = {
  idempotent?: boolean;
  route: "commit" | "development" | "test-writing";
  runId: string;
  stage: "code-review";
  status: "advanced" | "requeued";
  stepId: string;
  traceId?: string;
};

const developmentLoopMaxAttempts =
  defaultLoopManifest.loops.find(({ key }) => key === "development-loop")?.retryPolicy
    .maxAttempts ?? 1;

function metadataWithoutExecutionClaims(metadata: RunMetadata | null): RunMetadata {
  const {
    implementationClaim: _implementationClaim,
    testWritingClaim: _testWritingClaim,
    validationReviewClaim: _validationReviewClaim,
    ...rest
  } = metadata ?? {};
  return rest;
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return computeValidationReviewDigest(left) === computeValidationReviewDigest(right);
}

export async function applyDevelopmentLoopValidationReviewResult(input: {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  metrics?: DevelopmentLoopTransitionMetrics;
  occurredAt?: Date;
  output: ValidationReviewResult;
  runId: string;
}): Promise<ValidationReviewTransitionResult> {
  const occurredAt = input.occurredAt ?? new Date();
  const transitionStartedAt = Date.now();
  const output = validationReviewResultSchema.parse(input.output);
  const digest = computeValidationReviewDigest(output);
  const span = startLoopworksSpan("loopworks.validation_review.transition", {
    attributes: {
      "loopworks.attempt": output.binding.reviewAttempt,
      "loopworks.finding_count": output.findings.length,
      "loopworks.route": output.recommendation.route,
      "loopworks.run_id": input.runId,
      "loopworks.screenshot_count": output.evidence.screenshots.length,
      "loopworks.stage": "code-review",
      "loopworks.validation_evidence_count": output.evidence.validationResults.length,
    },
  });
  let retryMetric: DevelopmentLoopStepRetryMetricInput | undefined;

  try {
    const result = await input.database.transaction<ValidationReviewTransitionResult>(
      async (tx) => {
        await assertDevelopmentLoopExecutionLease(tx, input.runId, "code-review");
        const [run] = await tx
          .select({
            currentStage: loopRuns.currentStage,
            id: loopRuns.id,
            loopKey: loopRuns.loopKey,
            metadata: loopRuns.metadata,
            repositoryFullName: repositories.fullName,
            status: loopRuns.status,
            traceId: loopRuns.traceId,
          })
          .from(loopRuns)
          .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
          .where(eq(loopRuns.id, input.runId))
          .limit(1);
        if (!run) throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);

        const priorHistory = validationReviewHistory(run.metadata);
        const priorAttempt = priorHistory.find(
          ({ attempt }) => attempt === output.binding.reviewAttempt,
        );
        if (priorAttempt) {
          if (
            priorAttempt.digest !== digest ||
            priorAttempt.route !== output.recommendation.route
          ) {
            throw new DevelopmentLoopTransitionError(
              "Validation review replay does not match the previously applied result.",
            );
          }
          const reviewStep = (
            await tx
              .select()
              .from(runSteps)
              .where(and(eq(runSteps.runId, input.runId), eq(runSteps.stage, "code-review")))
          )[0];
          if (!reviewStep) throw new DevelopmentLoopTransitionError("Code-review step is missing.");
          return {
            idempotent: true,
            route: priorAttempt.route,
            runId: input.runId,
            stage: "code-review",
            status: priorAttempt.route === "commit" ? "advanced" : "requeued",
            stepId: reviewStep.id,
            ...((reviewStep.traceId ?? run.traceId)
              ? { traceId: reviewStep.traceId ?? run.traceId ?? undefined }
              : {}),
          };
        }

        const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
        const stepByStage = new Map(steps.map((step) => [step.stage, step]));
        const validationStep = stepByStage.get("validation");
        const reviewStep = stepByStage.get("code-review");
        if (!validationStep || !reviewStep) {
          throw new DevelopmentLoopTransitionError(
            "Validation review requires validation and code-review steps.",
          );
        }
        if (
          run.currentStage !== "code-review" ||
          run.status !== "running" ||
          validationStep.status !== "succeeded" ||
          !["queued", "running"].includes(reviewStep.status)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review cannot run before completed passing validation.",
          );
        }
        if (
          output.binding.runId !== input.runId ||
          output.binding.reviewAttempt !== reviewStep.attempt
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review result is not bound to the active run attempt.",
          );
        }

        const planRows = await tx
          .select()
          .from(agentPlans)
          .where(eq(agentPlans.runId, input.runId));
        const planApprovals = await tx
          .select()
          .from(approvals)
          .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
        if (planRows.length !== 1 || planApprovals.length !== 1) {
          throw new DevelopmentLoopTransitionError(
            "Validation review requires exactly one approved plan.",
          );
        }
        const [planRow] = planRows;
        const [approval] = planApprovals;
        if (!planRow || !approval) {
          throw new DevelopmentLoopTransitionError(
            "Validation review plan context changed while it was being loaded.",
          );
        }
        const plan = pinnedPlanningAgentOutputSchema.parse(planRow.plan);
        if (
          planRow.status !== "approved" ||
          approval.status !== "approved" ||
          approval.metadata?.planId !== planRow.id ||
          approval.metadata?.planSha256 !== plan.identity.sha256 ||
          computePlanningArtifactDigest(plan) !== plan.identity.sha256
        ) {
          throw new DevelopmentLoopTransitionError("Validation review plan identity is invalid.");
        }

        const rows = await tx.select().from(artifacts).where(eq(artifacts.runId, input.runId));
        const exactArtifact = (
          stage: string,
          type: string,
          predicate?: (row: (typeof rows)[number]) => boolean,
        ) => {
          const stageStep = stepByStage.get(stage);
          const matches = rows.filter(
            (row) =>
              row.stepId === stageStep?.id && row.type === type && (!predicate || predicate(row)),
          );
          if (matches.length !== 1) {
            throw new DevelopmentLoopTransitionError(
              `Validation review requires exactly one ${stage} ${type} artifact.`,
            );
          }
          const [match] = matches;
          if (!match) {
            throw new DevelopmentLoopTransitionError(
              `Validation review ${stage} ${type} artifact disappeared.`,
            );
          }
          return match;
        };
        const testPlanArtifact = exactArtifact("test-writing", "test_plan");
        const implementationArtifact = exactArtifact("development", "patch");
        const validationArtifact = exactArtifact("validation", "validation_report");
        const screenshotArtifact = exactArtifact("validation", "screenshot");
        const reviewArtifact = exactArtifact("code-review", "log_summary");
        const testPlan = testPlanArtifactSchema.parse(testPlanArtifact.metadata?.testPlan);
        const implementation = implementationResultSchema.parse(
          implementationArtifact.metadata?.implementationResult,
        );
        const report = validationReportArtifactMetadataSchema.parse(
          validationArtifact.metadata,
        ).validationReport;
        const screenshots = screenshotEvidenceSchema.parse(
          screenshotArtifact.metadata?.screenshotEvidence,
        );
        if (
          report.overallOutcome !== "pass" ||
          report.results.length === 0 ||
          report.results.some(
            (entry) => entry.outcome !== "pass" || (entry.required && entry.outcome !== "pass"),
          )
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review cannot run before completed passing validation.",
          );
        }

        const expectedCriteria = plan.issue.acceptanceCriteria.map((text, index) => ({
          id: `ac-${index + 1}`,
          text,
        }));
        const expectedImplementationBinding = {
          planId: plan.identity.id,
          planSha256: plan.identity.sha256,
          testPlanSha256: computeTestPlanDigest(testPlan),
          testPatchSha256: testPlan.patch.sha256,
          fixturesSha256: computeImplementationDigest(testPlan.fixtures),
          repositoryFullName: plan.issue.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
        };
        if (
          testPlan.plan.id !== plan.identity.id ||
          testPlan.plan.sha256 !== plan.identity.sha256 ||
          testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
          testPlan.plan.commitSha !== plan.repositoryRevision.commitSha ||
          JSON.stringify(testPlan.acceptanceCriteria) !== JSON.stringify(expectedCriteria) ||
          !sameCanonicalValue(implementation.binding, expectedImplementationBinding)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review persisted artifacts do not share the approved handoff binding.",
          );
        }

        const expectedBinding = {
          runId: input.runId,
          reviewAttempt: reviewStep.attempt,
          planId: plan.identity.id,
          planSha256: plan.identity.sha256,
          testPlanSha256: computeTestPlanDigest(testPlan),
          implementationResultSha256: computeImplementationDigest(implementation),
          productionPatchSha256: implementation.patch.sha256,
          validationReportSha256: computeValidationReviewDigest(report),
          screenshotEvidenceSha256: computeScreenshotEvidenceDigest(screenshots),
          repositoryFullName: run.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
        };
        if (
          !sameCanonicalValue(output.binding, expectedBinding) ||
          testPlanArtifact.sha256 !== expectedBinding.testPlanSha256 ||
          implementationArtifact.sha256 !== expectedBinding.implementationResultSha256 ||
          validationArtifact.sha256 !== expectedBinding.validationReportSha256 ||
          screenshotArtifact.sha256 !== expectedBinding.screenshotEvidenceSha256
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review result is not bound to the persisted evidence.",
          );
        }
        assertScreenshotEvidenceBinding(screenshots, {
          repositoryFullName: plan.issue.repositoryFullName,
          commitSha: plan.repositoryRevision.commitSha,
          testPlanSha256: computeTestPlanDigest(testPlan),
          productionPatchSha256: implementation.patch.sha256,
        });
        assertScreenshotEvidenceCoverage(screenshots, {
          uiAffecting: classifyUiAffectingChange({
            productionPaths: implementation.patch.paths,
            tests: testPlan.tests,
          }),
          browserTestIds: screenshotBrowserTests(testPlan.tests).map(({ id }) => id),
        });
        const expectedValidationEvidence = report.results.map(
          ({ key, command, outcome, output }) => ({
            key,
            command,
            outcome: outcome as "pass",
            ...(output?.sha256 ? { outputSha256: output.sha256 } : {}),
          }),
        );
        const expectedScreenshotEvidence = screenshots.captures.map(
          ({ id, testId, viewport, width, height, uri, sha256 }) => ({
            id,
            testId,
            viewport,
            width,
            height,
            uri,
            sha256,
          }),
        );
        if (
          !sameCanonicalValue(output.evidence.validationResults, expectedValidationEvidence) ||
          !sameCanonicalValue(output.evidence.screenshots, expectedScreenshotEvidence)
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review citations do not exactly match persisted evidence.",
          );
        }
        if (
          output.recommendation.route !== "commit" &&
          reviewStep.attempt >= developmentLoopMaxAttempts
        ) {
          throw new DevelopmentLoopTransitionError(
            "Validation review retry budget is exhausted for this run.",
          );
        }

        const claimId = randomUUID();
        const [claimedStep] = await tx
          .update(runSteps)
          .set({ metadata: { ...(reviewStep.metadata ?? {}), validationReviewClaim: claimId } })
          .where(
            and(
              eq(runSteps.id, reviewStep.id),
              sql`not coalesce(${runSteps.metadata} ? 'validationReviewClaim', false)`,
            ),
          )
          .returning({ id: runSteps.id });
        if (!claimedStep) {
          throw new DevelopmentLoopTransitionError(
            `Validation review transition is already in progress for run ${input.runId}.`,
          );
        }

        await tx
          .update(artifacts)
          .set({
            metadata: {
              validationReviewMetadataKind: "validation_review_result",
              validationReviewResult: output,
              validationReviewResultSchemaId: output.schemaId,
              validationReviewVersion: output.version,
            },
            sha256: digest,
          })
          .where(eq(artifacts.id, reviewArtifact.id));

        const route = output.recommendation.route;
        const traceId = reviewStep.traceId ?? run.traceId;
        const historyEntry: ValidationReviewHistoryEntry = {
          attempt: reviewStep.attempt,
          digest,
          findingCount: output.findings.length,
          occurredAt: occurredAt.toISOString(),
          reasonSha256: computeValidationReviewDigest(output.recommendation.reason),
          route,
        };
        const runMetadata = {
          ...metadataWithoutBlockedReason(run.metadata),
          validationReviewHistory: [...priorHistory, historyEntry],
        };

        if (route === "commit") {
          await tx
            .update(runSteps)
            .set({
              completedAt: occurredAt,
              metadata: metadataWithoutExecutionClaims(reviewStep.metadata),
              startedAt: reviewStep.startedAt ?? occurredAt,
              status: "succeeded",
              traceId,
            })
            .where(eq(runSteps.id, reviewStep.id));
          await tx
            .update(loopRuns)
            .set({ currentStage: "commit", metadata: runMetadata, status: "running" })
            .where(eq(loopRuns.id, input.runId));
        } else {
          const resetStages =
            route === "development"
              ? ["development", "validation", "code-review"]
              : ["test-writing", "development", "validation", "code-review"];
          for (const stage of resetStages) {
            const step = stepByStage.get(stage);
            if (!step) throw new DevelopmentLoopTransitionError(`Run is missing ${stage} step.`);
            await tx
              .update(runSteps)
              .set({
                attempt: step.attempt + 1,
                completedAt: null,
                metadata: metadataWithoutExecutionClaims(step.metadata),
                queuedAt: occurredAt,
                startedAt: null,
                status: "queued",
                traceId: step.traceId ?? run.traceId,
                validationStatus:
                  stage === "test-writing" ? "red" : stage === "validation" ? "required" : null,
              })
              .where(eq(runSteps.id, step.id));
          }

          const resetArtifact = async (artifactId: string, metadata: RunMetadata) => {
            await tx
              .update(artifacts)
              .set({ metadata, sha256: null })
              .where(eq(artifacts.id, artifactId));
          };
          if (route === "test-writing") {
            const redArtifact = exactArtifact("test-writing", "validation_report");
            await resetArtifact(testPlanArtifact.id, createTestPlanArtifactContractMetadata());
            await resetArtifact(redArtifact.id, createRedTestEvidenceArtifactContractMetadata());
          }
          await resetArtifact(
            implementationArtifact.id,
            createImplementationArtifactContractMetadata(),
          );
          await resetArtifact(
            validationArtifact.id,
            createValidationReportArtifactContractMetadata(),
          );
          await resetArtifact(
            screenshotArtifact.id,
            createScreenshotEvidenceArtifactContractMetadata(),
          );
          await resetArtifact(reviewArtifact.id, createValidationReviewArtifactContractMetadata());
          await tx
            .update(loopRuns)
            .set({ currentStage: route, metadata: runMetadata, status: "queued" })
            .where(eq(loopRuns.id, input.runId));
          retryMetric = {
            loopKey: run.loopKey,
            reason: "validation-review",
            stage: route,
          };
        }

        return {
          route,
          runId: input.runId,
          stage: "code-review",
          status: route === "commit" ? "advanced" : "requeued",
          stepId: reviewStep.id,
          ...(traceId ? { traceId } : {}),
        };
      },
    );

    emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
      durationSeconds: Math.max(0, Date.now() - transitionStartedAt) / 1000,
      loopKey: "development-loop",
      stage: "code-review",
      status: "succeeded",
    });
    if (retryMetric) {
      emitSafely(input.metrics?.stepRetry ?? recordDevelopmentLoopStepRetryMetric, retryMetric);
    }
    input.logger?.info(
      {
        attempt: output.binding.reviewAttempt,
        durationMs: Math.max(0, Date.now() - transitionStartedAt),
        findingCount: output.findings.length,
        idempotent: result.idempotent,
        route: result.route,
        runId: result.runId,
        screenshotCount: output.evidence.screenshots.length,
        stepId: result.stepId,
        validationEvidenceCount: output.evidence.validationResults.length,
      },
      "validation_review_stage_routed",
    );
    span.setAttributes({
      "loopworks.duration_ms": Math.max(0, Date.now() - transitionStartedAt),
      "loopworks.idempotent": result.idempotent ?? false,
      "loopworks.outcome": result.status,
    });
    markLoopworksSpanOk(span);
    return result;
  } catch (error) {
    markLoopworksSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
}
