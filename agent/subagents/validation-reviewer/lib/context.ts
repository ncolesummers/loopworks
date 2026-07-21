import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentPlans, approvals, artifacts, loopRuns, runSteps } from "@/db/schema";
import type { ScreenshotEvidence } from "@/lib/loops/screenshot-evidence";
import {
  assertScreenshotEvidenceCoverage,
  classifyUiAffectingChange,
  computeScreenshotEvidenceDigest,
  screenshotBrowserTests,
  screenshotEvidenceSchema,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationReportV1 } from "@/lib/loops/validation-report";
import { validationReportV1Schema } from "@/lib/loops/validation-report";
import {
  computeImplementationDigest,
  type ImplementationResult,
  implementationResultSchema,
} from "../../../implementation-agent";
import {
  computePlanningArtifactDigest,
  type PlanningAgentOutput,
  planningAgentOutputSchema,
} from "../../../planning-agent";
import {
  computeTestPlanDigest,
  type TestWritingAgentOutput,
  testPlanArtifactSchema,
} from "../../../test-writing-agent";
import { computeValidationReviewDigest } from "../../../validation-review-agent";
import { createValidationReviewFixtureContext } from "../../../validation-review-fixture";
import { resolveValidationReviewerFixtureMode } from "./fixture-mode";

export type ValidationReviewContext = {
  run: { id: string; currentStage: string; status: string };
  validationStep: { id: string; status: string };
  reviewStep: { id: string; status: string; attempt: number };
  planStatus: string;
  approvalStatus: string;
  plan: PlanningAgentOutput;
  testPlan: TestWritingAgentOutput["testPlan"];
  implementationResult: ImplementationResult;
  validationReport: ValidationReportV1;
  screenshotEvidence: ScreenshotEvidence;
  testPlanArtifactSha256: string | null;
  implementationArtifactSha256: string | null;
  validationArtifactSha256: string | null;
  screenshotArtifactSha256: string | null;
};

export function validateValidationReviewContext(
  input: ValidationReviewContext,
): ValidationReviewContext {
  const plan = planningAgentOutputSchema.parse(input.plan);
  const testPlan = testPlanArtifactSchema.parse(input.testPlan);
  const implementation = implementationResultSchema.parse(input.implementationResult);
  const report = validationReportV1Schema.parse(input.validationReport);
  const screenshots = screenshotEvidenceSchema.parse(input.screenshotEvidence);
  if (
    input.run.currentStage !== "code-review" ||
    input.run.status !== "running" ||
    input.validationStep.status !== "succeeded" ||
    !["queued", "running"].includes(input.reviewStep.status) ||
    input.planStatus !== "approved" ||
    input.approvalStatus !== "approved"
  ) {
    throw new Error("Validation review requires a running code-review stage after validation.");
  }
  if (
    report.overallOutcome !== "pass" ||
    report.results.length === 0 ||
    report.results.some(
      (result) => result.outcome !== "pass" || (result.required && result.outcome !== "pass"),
    )
  ) {
    throw new Error("Validation review requires complete passing deterministic validation.");
  }
  if (
    !plan.repositoryRevision ||
    computePlanningArtifactDigest(plan) !== plan.identity.sha256 ||
    testPlan.plan.id !== plan.identity.id ||
    testPlan.plan.sha256 !== plan.identity.sha256 ||
    testPlan.plan.repositoryFullName !== plan.issue.repositoryFullName ||
    testPlan.plan.commitSha !== plan.repositoryRevision.commitSha ||
    implementation.binding.planId !== plan.identity.id ||
    implementation.binding.planSha256 !== plan.identity.sha256 ||
    implementation.binding.testPlanSha256 !== computeTestPlanDigest(testPlan) ||
    implementation.binding.testPatchSha256 !== testPlan.patch.sha256 ||
    implementation.binding.fixturesSha256 !== computeImplementationDigest(testPlan.fixtures) ||
    implementation.binding.repositoryFullName !== plan.issue.repositoryFullName ||
    implementation.binding.commitSha !== plan.repositoryRevision.commitSha ||
    screenshots.binding.repositoryFullName !== plan.issue.repositoryFullName ||
    screenshots.binding.commitSha !== plan.repositoryRevision.commitSha ||
    screenshots.binding.testPlanSha256 !== computeTestPlanDigest(testPlan) ||
    screenshots.binding.productionPatchSha256 !== implementation.patch.sha256
  ) {
    throw new Error("Validation review context artifacts are not bound to the same handoff.");
  }
  const expectedCriteria = plan.issue.acceptanceCriteria.map((text, index) => ({
    id: `ac-${index + 1}`,
    text,
  }));
  if (JSON.stringify(testPlan.acceptanceCriteria) !== JSON.stringify(expectedCriteria)) {
    throw new Error("Validation review test plan does not match the approved acceptance criteria.");
  }
  assertScreenshotEvidenceCoverage(screenshots, {
    uiAffecting: classifyUiAffectingChange({
      productionPaths: implementation.patch.paths,
      tests: testPlan.tests,
    }),
    browserTestIds: screenshotBrowserTests(testPlan.tests).map(({ id }) => id),
  });
  if (
    input.testPlanArtifactSha256 !== computeTestPlanDigest(testPlan) ||
    input.implementationArtifactSha256 !== computeImplementationDigest(implementation) ||
    input.validationArtifactSha256 !== computeValidationReviewDigest(report) ||
    input.screenshotArtifactSha256 !== computeScreenshotEvidenceDigest(screenshots)
  ) {
    throw new Error("Validation review context artifacts are stale.");
  }
  return input;
}

export async function loadValidationReviewContext(runId: string): Promise<ValidationReviewContext> {
  if (resolveValidationReviewerFixtureMode().enabled) return createValidationReviewFixtureContext();
  const [run] = await db.select().from(loopRuns).where(eq(loopRuns.id, runId));
  if (!run) throw new Error(`Run ${runId} was not found.`);
  const [plans, planApprovals, steps, rows] = await Promise.all([
    db.select().from(agentPlans).where(eq(agentPlans.runId, runId)),
    db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "plan-review"))),
    db.select().from(runSteps).where(eq(runSteps.runId, runId)),
    db.select().from(artifacts).where(eq(artifacts.runId, runId)),
  ]);
  if (plans.length !== 1 || planApprovals.length !== 1) {
    throw new Error("Validation review requires exactly one plan and plan approval.");
  }
  const validationSteps = steps.filter(({ stage }) => stage === "validation");
  const reviewSteps = steps.filter(({ stage }) => stage === "code-review");
  if (validationSteps.length !== 1 || reviewSteps.length !== 1) {
    throw new Error("Validation review requires exact validation and code-review steps.");
  }
  const testPlanRows = rows.filter(({ type }) => type === "test_plan");
  const implementationRows = rows.filter(
    ({ type, metadata }) =>
      type === "patch" && metadata?.implementationMetadataKind === "implementation_result",
  );
  const validationRows = rows.filter(
    ({ type, stepId }) => type === "validation_report" && stepId === validationSteps[0]?.id,
  );
  const screenshotRows = rows.filter(
    ({ type, stepId }) => type === "screenshot" && stepId === validationSteps[0]?.id,
  );
  if (
    testPlanRows.length !== 1 ||
    implementationRows.length !== 1 ||
    validationRows.length !== 1 ||
    screenshotRows.length !== 1
  ) {
    throw new Error(
      "Validation review requires exact test, patch, validation, and screenshot artifacts.",
    );
  }
  const [planRow] = plans;
  const [approval] = planApprovals;
  const [validationStep] = validationSteps;
  const [reviewStep] = reviewSteps;
  const [testPlanRow] = testPlanRows;
  const [implementationRow] = implementationRows;
  const [validationRow] = validationRows;
  const [screenshotRow] = screenshotRows;
  if (
    !planRow ||
    !approval ||
    !validationStep ||
    !reviewStep ||
    !testPlanRow ||
    !implementationRow ||
    !validationRow ||
    !screenshotRow
  ) {
    throw new Error("Validation review context changed while it was being loaded.");
  }
  return validateValidationReviewContext({
    run: { id: run.id, currentStage: run.currentStage, status: run.status },
    validationStep: { id: validationStep.id, status: validationStep.status },
    reviewStep: { id: reviewStep.id, status: reviewStep.status, attempt: reviewStep.attempt },
    planStatus: planRow.status,
    approvalStatus:
      approval.metadata?.planId === planRow.id &&
      approval.metadata?.planSha256 ===
        (planRow.plan as { identity?: { sha256?: string } })?.identity?.sha256
        ? approval.status
        : "mismatched",
    plan: planningAgentOutputSchema.parse(planRow.plan),
    testPlan: testPlanArtifactSchema.parse(testPlanRow.metadata?.testPlan),
    implementationResult: implementationResultSchema.parse(
      implementationRow.metadata?.implementationResult,
    ),
    validationReport: validationReportV1Schema.parse(validationRow.metadata?.validationReport),
    screenshotEvidence: screenshotEvidenceSchema.parse(screenshotRow.metadata?.screenshotEvidence),
    testPlanArtifactSha256: testPlanRow.sha256,
    implementationArtifactSha256: implementationRow.sha256,
    validationArtifactSha256: validationRow.sha256,
    screenshotArtifactSha256: screenshotRow.sha256,
  });
}
