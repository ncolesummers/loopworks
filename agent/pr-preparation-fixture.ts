import { createPlanningAgentSeedPlan } from "./planning-agent";
import { computePrPreparationDigest } from "./pr-preparation-agent";
import {
  computeValidationReviewDigest,
  type ValidationReviewResult,
  validationReviewAgentModelLabel,
  validationReviewResultSchemaId,
} from "./validation-review-agent";
import type { ScreenshotEvidence } from "@/lib/loops/screenshot-evidence";
import {
  computeScreenshotEvidenceDigest,
  screenshotEvidenceSchemaId,
} from "@/lib/loops/screenshot-evidence";
import type { ValidationReportV1 } from "@/lib/loops/validation-report";

export function createPrPreparationFixtureContext(input?: {
  deployment?: {
    branch?: string;
    commitSha?: string;
    environment: string;
    status: string;
    url: string;
  } | null;
  uiAffecting?: boolean;
}) {
  const runId = "00000000-0000-4000-8000-000000000050";
  const planId = "00000000-0000-4000-8000-000000000150";
  const commitSha = "1".repeat(40);
  const plan = createPlanningAgentSeedPlan({
    body: "## Acceptance Criteria\n- Prepare a typed PR intent from exact durable evidence.",
    issueNumber: 50,
    issueUrl: "https://github.com/ncolesummers/loopworks/issues/50",
    labels: ["area:agents", "loop:development"],
    milestone: "M4 Validation + PR Path + MVP Security Review",
    repositoryFullName: "ncolesummers/loopworks",
    repositoryRevision: { ref: "main", commitSha },
    title: "PR preparation subagent for PR intent content",
  });
  const validationReport: ValidationReportV1 = {
    version: 1,
    schemaId: "loopworks.validation_report.v1",
    generatedAt: "2026-07-20T20:00:00.000Z",
    overallOutcome: "pass",
    counts: { failed: 0, passed: 1, skipped: 0, total: 1 },
    results: [
      {
        key: "aggregate-validation",
        name: "Aggregate validation",
        command: "bun run validate",
        durationMs: 20,
        exitCode: 0,
        outcome: "pass",
        phase: "before_review",
        produces: "validation_report",
        required: true,
        output: {
          uri: "artifact://validation/aggregate.log",
          sha256: "2".repeat(64),
          stdoutBytes: 10,
          stderrBytes: 0,
          truncated: false,
        },
      },
    ],
  };
  const uiAffecting = input?.uiAffecting ?? true;
  const screenshotEvidence: ScreenshotEvidence = {
    version: 1,
    schemaId: screenshotEvidenceSchemaId,
    binding: {
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha,
      testPlanSha256: "3".repeat(64),
      productionPatchSha256: "4".repeat(64),
    },
    uiAffecting,
    browserTestIds: uiAffecting ? ["browser-ac-1"] : [],
    captures: uiAffecting
      ? (
          [
            ["mobile", 390, 844],
            ["laptop", 1280, 832],
            ["desktop", 1440, 960],
          ] as const
        ).map(([viewport, width, height], index) => ({
          id: `browser-ac-1-${viewport}`,
          testId: "browser-ac-1",
          viewport,
          width,
          height,
          mimeType: "image/png" as const,
          uri: `artifact://screenshots/browser-ac-1-${viewport}.png`,
          sha256: String(index + 5).repeat(64),
          byteCount: 100,
        }))
      : [],
  };
  const validationReportSha256 = computeValidationReviewDigest(validationReport);
  const screenshotEvidenceSha256 = computeScreenshotEvidenceDigest(screenshotEvidence);
  const validationReviewResult: ValidationReviewResult = {
    version: 1,
    schemaId: validationReviewResultSchemaId,
    model: validationReviewAgentModelLabel,
    binding: {
      runId,
      reviewAttempt: 1,
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: screenshotEvidence.binding.testPlanSha256,
      implementationResultSha256: "7".repeat(64),
      productionPatchSha256: screenshotEvidence.binding.productionPatchSha256,
      validationReportSha256,
      screenshotEvidenceSha256,
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha,
    },
    evidence: {
      validationResults: [
        {
          key: "aggregate-validation",
          command: "bun run validate",
          outcome: "pass",
          outputSha256: "2".repeat(64),
        },
      ],
      screenshots: screenshotEvidence.captures.map(
        ({ id, testId, viewport, width, height, uri, sha256: digest }) => ({
          id,
          testId,
          viewport,
          width,
          height,
          uri,
          sha256: digest,
        }),
      ),
    },
    findings: [],
    recommendation: {
      route: "commit",
      reason: "Deterministic evidence is complete and no blocking finding remains.",
      findingIds: [],
      validationCitationKeys: ["aggregate-validation"],
      screenshotCitationIds: screenshotEvidence.captures.map(({ id }) => id),
    },
  };
  const validationReviewResultSha256 = computeValidationReviewDigest(validationReviewResult);
  const completedArtifacts = [
    {
      title: "Validation report",
      type: "validation_report",
      uri: "https://github.com/ncolesummers/loopworks/issues/50#validation",
      sha256: validationReportSha256,
    },
    {
      title: "Validation screenshots",
      type: "screenshot",
      uri: "https://github.com/ncolesummers/loopworks/issues/50#screenshots",
      sha256: screenshotEvidenceSha256,
    },
    {
      title: "Code review notes",
      type: "log_summary",
      uri: "https://github.com/ncolesummers/loopworks/issues/50#review",
      sha256: validationReviewResultSha256,
    },
  ];
  const deployment =
    input && "deployment" in input
      ? (input.deployment ?? null)
      : {
          branch: "codex/50-pr-subagent",
          commitSha,
          environment: "preview",
          status: "ready",
          url: "https://loopworks-pr-50.vercel.app",
        };

  return {
    run: {
      id: runId,
      currentStage: "pr",
      status: "running",
      runUrl: `https://loopworks.example/runs?run=${runId}`,
      issueNumber: 50,
      issueTitle: plan.issue.title,
      issueUrl: plan.issue.url,
      repositoryFullName: plan.issue.repositoryFullName,
      commitSha,
    },
    planId,
    planStatus: "approved",
    approvalStatus: "approved",
    approvalPlanId: planId,
    approvalPlanSha256: plan.identity.sha256,
    plan,
    validationStep: { id: "00000000-0000-4000-8000-000000000250", status: "succeeded" },
    reviewStep: { id: "00000000-0000-4000-8000-000000000350", status: "succeeded" },
    commitStep: { id: "00000000-0000-4000-8000-000000000450", status: "succeeded" },
    prStep: {
      id: "00000000-0000-4000-8000-000000000550",
      status: "queued",
      attempt: 1,
    },
    validationReport,
    validationReviewResult,
    screenshotEvidence,
    completedArtifacts,
    deployment,
    validationArtifactSha256: validationReportSha256,
    validationArtifactUri: completedArtifacts[0]?.uri ?? "",
    reviewArtifactSha256: validationReviewResultSha256,
    screenshotArtifactSha256: screenshotEvidenceSha256,
    artifactSetSha256: computePrPreparationDigest(completedArtifacts),
    deploymentContextSha256: deployment ? computePrPreparationDigest(deployment) : undefined,
  };
}
