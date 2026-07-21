import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  agentPlans,
  approvals,
  artifacts,
  deployments,
  loopRuns,
  repositories,
  runSteps,
} from "@/db/schema";
import { composePrIntent } from "@/lib/loops/pr-intent";
import { assertCanonicalLoopworksRunUrl } from "@/lib/loops/run-url";
import {
  assertScreenshotEvidenceCoverage,
  computeScreenshotEvidenceDigest,
  type ScreenshotEvidence,
  screenshotEvidenceSchema,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationReportV1 } from "@/lib/loops/validation-report";
import {
  validationReportArtifactMetadataSchema,
  validationReportV1Schema,
} from "@/lib/loops/validation-report";
import {
  computePlanningArtifactDigest,
  type PlanningAgentOutput,
  planningAgentOutputSchema,
} from "../../../planning-agent";
import { createPrPreparationFixtureContext } from "../../../pr-preparation-fixture";
import {
  computePrPreparationDigest,
  prPreparationAgentModelLabel,
  type PrPreparationResult,
  prPreparationResultSchema,
  prPreparationResultSchemaId,
} from "../../../pr-preparation-agent";
import {
  computeValidationReviewDigest,
  type ValidationReviewResult,
  validationReviewResultSchema,
} from "../../../validation-review-agent";
import { resolvePrPreparerFixtureMode } from "./fixture-mode";

const safeNarrativeSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) =>
      !/(?:authorization\s*:|bearer\s+|password\s*[:=]|token\s*[:=]|secret\s*[:=]|gh[pousr]_|sk-[a-z0-9]|-----BEGIN|data:image\/|raw (?:stdout|stderr|prompt))/i.test(
        value,
      ),
    "PR narrative contains forbidden secret-like or raw evidence content.",
  );
const safeEvidenceTextSchema = safeNarrativeSchema.max(500);
const safeHttpUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  const sensitiveKey =
    /^(?:access_?token|auth(?:orization)?|credential|password|secret|api[-_]?key)$/i;
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password &&
    ![...url.searchParams.keys()].some((key) => sensitiveKey.test(key))
  );
}, "Evidence links must use HTTP(S) without credentials or sensitive query data.");
const artifactReferenceSchema = z
  .object({
    title: safeEvidenceTextSchema,
    type: safeEvidenceTextSchema,
    uri: safeHttpUrlSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const deploymentContextSchema = z
  .object({
    branch: safeEvidenceTextSchema.optional(),
    commitSha: safeEvidenceTextSchema.optional(),
    environment: safeEvidenceTextSchema,
    status: safeEvidenceTextSchema,
    url: safeHttpUrlSchema,
  })
  .strict();

export const prPreparationNarrativeSchema = z
  .object({ title: safeNarrativeSchema.max(240), summary: safeNarrativeSchema })
  .strict();

export type PrPreparationArtifactReference = {
  title: string;
  type: string;
  uri: string;
  sha256: string;
};

export type PrPreparationDeploymentContext = {
  branch?: string;
  commitSha?: string;
  environment: string;
  status: string;
  url: string;
};

export type PrPreparationReadDatabase = Pick<typeof db, "select">;

export type PrPreparationContext = {
  run: {
    id: string;
    currentStage: string;
    status: string;
    runUrl: string;
    issueNumber: number;
    issueTitle: string;
    issueUrl: string;
    repositoryFullName: string;
    commitSha: string;
  };
  planId: string;
  planStatus: string;
  approvalStatus: string;
  approvalPlanId?: unknown;
  approvalPlanSha256?: unknown;
  plan: PlanningAgentOutput;
  validationStep: { id: string; status: string };
  reviewStep: { id: string; status: string };
  commitStep: { id: string; status: string };
  prStep: { id: string; status: string; attempt: number };
  validationReport: ValidationReportV1;
  validationReviewResult: ValidationReviewResult;
  screenshotEvidence: ScreenshotEvidence;
  completedArtifacts: PrPreparationArtifactReference[];
  deployment: PrPreparationDeploymentContext | null;
  validationArtifactSha256: string | null;
  validationArtifactUri: string;
  reviewArtifactSha256: string | null;
  screenshotArtifactSha256: string | null;
  artifactSetSha256: string;
  deploymentContextSha256?: string;
};

function containsArtifactDigest(
  artifacts: PrPreparationArtifactReference[],
  type: string,
  sha256: string | null,
): boolean {
  return artifacts.some((artifact) => artifact.type === type && artifact.sha256 === sha256);
}

export function validatePrPreparationContext(input: PrPreparationContext): PrPreparationContext {
  const plan = planningAgentOutputSchema.parse(input.plan);
  const report = validationReportV1Schema.parse(input.validationReport);
  const review = validationReviewResultSchema.parse(input.validationReviewResult);
  const screenshots = screenshotEvidenceSchema.parse(input.screenshotEvidence);
  z.array(artifactReferenceSchema).parse(input.completedArtifacts);
  if (input.deployment) deploymentContextSchema.parse(input.deployment);
  safeHttpUrlSchema.parse(input.run.runUrl);
  safeHttpUrlSchema.parse(input.run.issueUrl);
  safeEvidenceTextSchema.parse(input.run.issueTitle);

  if (
    input.run.currentStage !== "pr" ||
    input.run.status !== "running" ||
    input.validationStep.status !== "succeeded" ||
    input.reviewStep.status !== "succeeded" ||
    input.commitStep.status !== "succeeded" ||
    !["queued", "running"].includes(input.prStep.status)
  ) {
    throw new Error(
      "PR preparation requires the running PR stage after validation, review, and commit.",
    );
  }
  if (
    input.planStatus !== "approved" ||
    input.approvalStatus !== "approved" ||
    input.approvalPlanId !== input.planId ||
    input.approvalPlanSha256 !== plan.identity.sha256 ||
    computePlanningArtifactDigest(plan) !== plan.identity.sha256
  ) {
    throw new Error("PR preparation requires the exact approved planning artifact.");
  }
  if (
    report.overallOutcome !== "pass" ||
    report.results.length === 0 ||
    report.results.some(
      (result) => result.outcome !== "pass" || (result.required && result.outcome !== "pass"),
    )
  ) {
    throw new Error("PR preparation requires complete passing deterministic validation.");
  }
  if (
    review.recommendation.route !== "commit" ||
    review.binding.runId !== input.run.id ||
    review.binding.planId !== plan.identity.id ||
    review.binding.planSha256 !== plan.identity.sha256 ||
    review.binding.validationReportSha256 !== computeValidationReviewDigest(report) ||
    review.binding.screenshotEvidenceSha256 !== computeScreenshotEvidenceDigest(screenshots) ||
    review.binding.repositoryFullName !== input.run.repositoryFullName ||
    review.binding.commitSha !== input.run.commitSha
  ) {
    throw new Error("PR preparation requires an exact validation review routed to commit.");
  }
  if (
    !plan.repositoryRevision ||
    plan.issue.repositoryFullName !== input.run.repositoryFullName ||
    plan.repositoryRevision.commitSha !== input.run.commitSha ||
    plan.issue.number !== input.run.issueNumber ||
    plan.issue.url !== input.run.issueUrl
  ) {
    throw new Error("PR preparation issue and repository identity do not match the approved plan.");
  }
  if (
    screenshots.binding.repositoryFullName !== input.run.repositoryFullName ||
    screenshots.binding.commitSha !== input.run.commitSha
  ) {
    throw new Error("PR preparation screenshot evidence is not bound to the repository revision.");
  }
  assertScreenshotEvidenceCoverage(screenshots, {
    uiAffecting: screenshots.uiAffecting,
    browserTestIds: screenshots.browserTestIds,
  });
  if (
    input.validationArtifactSha256 !== computeValidationReviewDigest(report) ||
    input.reviewArtifactSha256 !== computeValidationReviewDigest(review) ||
    input.screenshotArtifactSha256 !== computeScreenshotEvidenceDigest(screenshots) ||
    input.artifactSetSha256 !== computePrPreparationDigest(input.completedArtifacts) ||
    !containsArtifactDigest(
      input.completedArtifacts,
      "validation_report",
      input.validationArtifactSha256,
    ) ||
    !input.completedArtifacts.some(
      (artifact) =>
        artifact.type === "validation_report" &&
        artifact.sha256 === input.validationArtifactSha256 &&
        artifact.uri === input.validationArtifactUri,
    ) ||
    !containsArtifactDigest(input.completedArtifacts, "log_summary", input.reviewArtifactSha256) ||
    !containsArtifactDigest(input.completedArtifacts, "screenshot", input.screenshotArtifactSha256)
  ) {
    throw new Error("PR preparation context artifacts are stale or incomplete.");
  }
  const expectedDeploymentDigest = input.deployment
    ? computePrPreparationDigest(input.deployment)
    : undefined;
  if (input.deploymentContextSha256 !== expectedDeploymentDigest) {
    throw new Error("PR preparation deployment context is stale.");
  }
  return input;
}

export function createPrPreparationResultFromContext(
  input: PrPreparationContext,
  narrativeInput: z.input<typeof prPreparationNarrativeSchema>,
): PrPreparationResult {
  const context = validatePrPreparationContext(input);
  const narrative = prPreparationNarrativeSchema.parse(narrativeInput);
  const screenshots = context.screenshotEvidence.captures.map(
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
  const intent = composePrIntent({
    artifacts: context.completedArtifacts.map(({ title, type, uri }) => ({ title, type, uri })),
    ...(context.deployment ? { deployment: context.deployment } : {}),
    issue: {
      number: context.run.issueNumber,
      title: context.run.issueTitle,
      url: context.run.issueUrl,
    },
    run: { id: context.run.id, url: context.run.runUrl },
    screenshots,
    summary: narrative.summary,
    title: narrative.title,
    validation: {
      artifactUri: context.validationArtifactUri,
      report: context.validationReport,
    },
  });
  return prPreparationResultSchema.parse({
    version: 1,
    schemaId: prPreparationResultSchemaId,
    model: prPreparationAgentModelLabel,
    narrative,
    binding: {
      runId: context.run.id,
      prAttempt: context.prStep.attempt,
      planId: context.plan.identity.id,
      planSha256: context.plan.identity.sha256,
      validationReportSha256: context.validationArtifactSha256,
      validationReviewResultSha256: context.reviewArtifactSha256,
      screenshotEvidenceSha256: context.screenshotArtifactSha256,
      artifactSetSha256: context.artifactSetSha256,
      ...(context.deploymentContextSha256
        ? { deploymentContextSha256: context.deploymentContextSha256 }
        : {}),
      repositoryFullName: context.run.repositoryFullName,
      commitSha: context.run.commitSha,
    },
    intent,
    screenshots,
  });
}

function issueTitleFromMetadata(metadata: Record<string, unknown> | null, issueNumber: number) {
  const value = metadata?.issueTitle;
  return typeof value === "string" && value.trim() ? value : `Issue #${issueNumber}`;
}

export async function loadPrPreparationContextWithDatabase(
  database: PrPreparationReadDatabase,
  runId: string,
  runUrl: string,
): Promise<PrPreparationContext> {
  const canonicalRunUrl = assertCanonicalLoopworksRunUrl(runId, runUrl);
  const [run] = await database
    .select({
      currentStage: loopRuns.currentStage,
      id: loopRuns.id,
      issueNumber: loopRuns.githubIssueNumber,
      issueUrl: loopRuns.githubIssueUrl,
      metadata: loopRuns.metadata,
      repositoryFullName: repositories.fullName,
      status: loopRuns.status,
    })
    .from(loopRuns)
    .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
    .where(eq(loopRuns.id, runId))
    .limit(1);
  if (!run?.issueNumber || !run.issueUrl) throw new Error(`Run ${runId} is missing issue context.`);

  const [plans, planApprovals, steps, rows, latestDeployments] = await Promise.all([
    database.select().from(agentPlans).where(eq(agentPlans.runId, runId)),
    database
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "plan-review"))),
    database.select().from(runSteps).where(eq(runSteps.runId, runId)),
    database.select().from(artifacts).where(eq(artifacts.runId, runId)),
    database
      .select()
      .from(deployments)
      .where(eq(deployments.runId, runId))
      .orderBy(desc(deployments.createdAt))
      .limit(1),
  ]);
  if (plans.length !== 1 || planApprovals.length !== 1) {
    throw new Error("PR preparation requires exactly one plan and plan approval.");
  }
  const exactStep = (stage: string) => {
    const matches = steps.filter((step) => step.stage === stage);
    if (matches.length !== 1 || !matches[0])
      throw new Error(`PR preparation requires one ${stage} step.`);
    return matches[0];
  };
  const validationStep = exactStep("validation");
  const reviewStep = exactStep("code-review");
  const commitStep = exactStep("commit");
  const prStep = exactStep("pr");
  const exactArtifact = (stepId: string, type: string) => {
    const matches = rows.filter((row) => row.stepId === stepId && row.type === type);
    if (matches.length !== 1 || !matches[0])
      throw new Error(`PR preparation requires one ${type} artifact.`);
    return matches[0];
  };
  const validationArtifact = exactArtifact(validationStep.id, "validation_report");
  const reviewArtifact = exactArtifact(reviewStep.id, "log_summary");
  const screenshotArtifact = exactArtifact(validationStep.id, "screenshot");
  const [planRow] = plans;
  const [approval] = planApprovals;
  if (!planRow || !approval) throw new Error("PR preparation context changed while loading.");
  const plan = planningAgentOutputSchema.parse(planRow.plan);
  if (!plan.repositoryRevision)
    throw new Error("PR preparation requires a pinned repository revision.");
  const succeededStepIds = new Set(
    steps.filter(({ status }) => status === "succeeded").map(({ id }) => id),
  );
  const completedArtifacts = rows
    .flatMap((row) =>
      row.stepId &&
      succeededStepIds.has(row.stepId) &&
      row.type !== "pr_intent" &&
      typeof row.sha256 === "string"
        ? [{ title: row.title, type: row.type, uri: row.uri, sha256: row.sha256 }]
        : [],
    )
    .sort((left, right) =>
      `${left.type}\u0000${left.title}\u0000${left.uri}`.localeCompare(
        `${right.type}\u0000${right.title}\u0000${right.uri}`,
      ),
    );
  const [deploymentRow] = latestDeployments;
  const deployment = deploymentRow
    ? {
        ...(deploymentRow.branch ? { branch: deploymentRow.branch } : {}),
        ...(deploymentRow.commitSha ? { commitSha: deploymentRow.commitSha } : {}),
        environment: deploymentRow.environment,
        status: deploymentRow.status,
        url: deploymentRow.url,
      }
    : null;
  return validatePrPreparationContext({
    run: {
      id: run.id,
      currentStage: run.currentStage,
      status: run.status,
      runUrl: canonicalRunUrl,
      issueNumber: run.issueNumber,
      issueTitle: issueTitleFromMetadata(run.metadata, run.issueNumber),
      issueUrl: run.issueUrl,
      repositoryFullName: run.repositoryFullName,
      commitSha: plan.repositoryRevision.commitSha,
    },
    planId: planRow.id,
    planStatus: planRow.status,
    approvalStatus: approval.status,
    approvalPlanId: approval.metadata?.planId,
    approvalPlanSha256: approval.metadata?.planSha256,
    plan,
    validationStep: { id: validationStep.id, status: validationStep.status },
    reviewStep: { id: reviewStep.id, status: reviewStep.status },
    commitStep: { id: commitStep.id, status: commitStep.status },
    prStep: { id: prStep.id, status: prStep.status, attempt: prStep.attempt },
    validationReport: validationReportArtifactMetadataSchema.parse(validationArtifact.metadata)
      .validationReport,
    validationReviewResult: validationReviewResultSchema.parse(
      reviewArtifact.metadata?.validationReviewResult,
    ),
    screenshotEvidence: screenshotEvidenceSchema.parse(
      screenshotArtifact.metadata?.screenshotEvidence,
    ),
    completedArtifacts,
    deployment,
    validationArtifactSha256: validationArtifact.sha256,
    validationArtifactUri: validationArtifact.uri,
    reviewArtifactSha256: reviewArtifact.sha256,
    screenshotArtifactSha256: screenshotArtifact.sha256,
    artifactSetSha256: computePrPreparationDigest(completedArtifacts),
    ...(deployment ? { deploymentContextSha256: computePrPreparationDigest(deployment) } : {}),
  });
}

export async function loadPrPreparationContext(
  runId: string,
  runUrl: string,
): Promise<PrPreparationContext> {
  if (resolvePrPreparerFixtureMode().enabled) return createPrPreparationFixtureContext();
  return loadPrPreparationContextWithDatabase(db, runId, runUrl);
}
