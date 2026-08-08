import { computePrPreparationDigest, prPreparationResultSchema } from "@agent/pr-preparation-agent";
import { and, eq } from "drizzle-orm";
import {
  approvals,
  approvalTransitionEvents,
  artifacts,
  loopRuns,
  repositories,
  runSteps,
} from "@/db/schema";
import type {
  GitHubFileChange,
  GitHubPullRequestWriteResult,
  GitHubPullRequestWriter,
} from "@/lib/github/pull-request";
import { createGitHubPullRequest, createPullRequestChangeDigest } from "@/lib/github/pull-request";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createPrIntentArtifactMetadata } from "@/lib/loops/pr-intent";
import { assertCanonicalLoopworksRunUrl } from "@/lib/loops/run-url";
import { validationReportArtifactMetadataSchema } from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { recordDevelopmentLoopStepDurationMetric } from "@/lib/observability/metrics";
import type { LoopManifest } from "../../../../schemas/loop-manifest";

import { scheduleDevelopmentLoopStageRetry } from "./finalization";
import {
  assertDevelopmentLoopExecutionLease,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
  type DevelopmentLoopTransitionMetrics,
  type DevelopmentLoopValidationTransitionStatus,
  durationSecondsBetween,
  emitSafely,
  metadataWithoutBlockedReason,
  prApprovalScope,
  type RunMetadata,
} from "./shared";

type PrStageTransitionResult = {
  artifactId: string;
  blockedReason?: string;
  idempotent?: boolean;
  mode: "development" | "live";
  pullRequestUrl?: string;
  runId: string;
  stage: "pr";
  status: DevelopmentLoopValidationTransitionStatus;
  stepId: string;
  traceId?: string;
};

type PrStageTransitionBaseInput = {
  database: DevelopmentLoopTransitionDatabase;
  logger?: LoopworksLogger;
  manifest?: LoopManifest;
  metrics?: DevelopmentLoopTransitionMetrics;
  now?: () => Date;
  occurredAt?: Date;
  runId: string;
  runUrl: string;
};

type DevelopmentPrStageInput = PrStageTransitionBaseInput & {
  mode: "development";
};

type LivePrStageInput = PrStageTransitionBaseInput & {
  actorId: string;
  changes: GitHubFileChange[];
  commitMessage: string;
  mode: "live";
  writer?: GitHubPullRequestWriter;
};

function metadataWithoutPrFailure(metadata: RunMetadata | null | undefined): RunMetadata {
  const {
    failureCode: _failureCode,
    retryable: _retryable,
    prChangeDigest: _prChangeDigest,
    ...rest
  } = metadata ?? {};
  return rest;
}

function approvalMetadataWithoutClaim(metadata: RunMetadata | null | undefined): RunMetadata {
  const { prWriteClaim: _prWriteClaim, ...rest } = metadata ?? {};
  return rest;
}

function validationGateKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function blockedPrStageResult(input: {
  artifactId: string;
  blockedReason: string;
  mode: "development" | "live";
  runId: string;
  stepId: string;
  traceId?: string | null;
}): PrStageTransitionResult {
  return {
    artifactId: input.artifactId,
    blockedReason: input.blockedReason,
    mode: input.mode,
    runId: input.runId,
    stage: "pr",
    status: "blocked",
    stepId: input.stepId,
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}

export async function executeDevelopmentLoopPrStage(
  input: DevelopmentPrStageInput | LivePrStageInput,
): Promise<PrStageTransitionResult> {
  const now = input.now ?? (() => new Date());
  const occurredAt = input.occurredAt ?? now();
  if (input.mode === "live") {
    let runUrl: URL;
    try {
      runUrl = new URL(input.runUrl);
    } catch {
      throw new DevelopmentLoopTransitionError(
        "Live PR creation requires an HTTPS Loopworks run URL.",
      );
    }
    if (runUrl.protocol !== "https:") {
      throw new DevelopmentLoopTransitionError(
        "Live PR creation requires an HTTPS Loopworks run URL.",
      );
    }
  }
  assertCanonicalLoopworksRunUrl(input.runId, input.runUrl);
  const requestedChangeDigest =
    input.mode === "live"
      ? createPullRequestChangeDigest({
          changes: input.changes,
          commitMessage: input.commitMessage,
        })
      : undefined;

  const prepared = await input.database.transaction(async (tx) => {
    await assertDevelopmentLoopExecutionLease(tx, input.runId, "pr");
    const [run] = await tx
      .select({
        currentStage: loopRuns.currentStage,
        defaultBranch: repositories.defaultBranch,
        githubIssueNumber: loopRuns.githubIssueNumber,
        githubIssueUrl: loopRuns.githubIssueUrl,
        installationId: repositories.installationId,
        loopKey: loopRuns.loopKey,
        metadata: loopRuns.metadata,
        repositoryName: repositories.name,
        repositoryOwner: repositories.owner,
        requiredValidationGates: repositories.validationGates,
        status: loopRuns.status,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(eq(loopRuns.id, input.runId))
      .limit(1);

    if (!run) {
      throw new DevelopmentLoopTransitionError(`Run ${input.runId} was not found.`);
    }
    if (!run.githubIssueNumber || !run.githubIssueUrl) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have source issue context.`,
      );
    }

    const steps = await tx.select().from(runSteps).where(eq(runSteps.runId, input.runId));
    const prStep = steps.find((step) => step.stage === "pr");
    const validationStep = steps.find((step) => step.stage === "validation");
    const reviewStep = steps.find((step) => step.stage === "code-review");
    const commitStep = steps.find((step) => step.stage === "commit");
    if (!prStep || !validationStep || !reviewStep || !commitStep) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have the required PR-stage predecessors.`,
      );
    }

    const runArtifacts = await tx.select().from(artifacts).where(eq(artifacts.runId, input.runId));
    const prArtifact = runArtifacts.find(
      (artifact) => artifact.stepId === prStep.id && artifact.type === "pr_intent",
    );
    const validationArtifact = runArtifacts.find(
      (artifact) => artifact.stepId === validationStep.id && artifact.type === "validation_report",
    );
    if (!prArtifact || !validationArtifact) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} does not have the required PR or validation artifact.`,
      );
    }

    if (prStep.completedAt && prStep.status === "succeeded") {
      const pullRequestUrl =
        typeof (prArtifact.metadata as { githubPullRequest?: { url?: unknown } } | null)
          ?.githubPullRequest?.url === "string"
          ? (prArtifact.metadata as { githubPullRequest: { url: string } }).githubPullRequest.url
          : undefined;
      return {
        result: {
          artifactId: prArtifact.id,
          idempotent: true,
          mode: input.mode,
          ...(pullRequestUrl ? { pullRequestUrl } : {}),
          runId: input.runId,
          stage: "pr" as const,
          status: "advanced" as const,
          stepId: prStep.id,
          ...((prStep.traceId ?? run.traceId)
            ? { traceId: prStep.traceId ?? run.traceId ?? undefined }
            : {}),
        },
      };
    }

    const parsedValidation = validationReportArtifactMetadataSchema.safeParse(
      validationArtifact.metadata,
    );
    const validationAdvanced =
      validationStep.status === "succeeded" &&
      parsedValidation.success &&
      parsedValidation.data.validationReport.overallOutcome === "pass" &&
      !parsedValidation.data.validationReport.results.some(
        (result) => result.required && result.outcome === "skipped",
      ) &&
      run.requiredValidationGates
        .map(validationGateKey)
        .filter(Boolean)
        .every((requiredKey) =>
          parsedValidation.data.validationReport.results.some(
            (result) => result.key === requiredKey && result.required && result.outcome === "pass",
          ),
        );
    if (!validationAdvanced) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Deterministic validation did not advance this run.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    if (
      run.currentStage !== "pr" ||
      reviewStep.status !== "succeeded" ||
      commitStep.status !== "succeeded"
    ) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Review and commit stages must succeed before PR creation.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    const parsedPreparation = prPreparationResultSchema.safeParse(
      (prArtifact.metadata as { prPreparationResult?: unknown } | null)?.prPreparationResult,
    );
    const persistedPreparationDigest = (
      prArtifact.metadata as { prPreparationResultSha256?: unknown } | null
    )?.prPreparationResultSha256;
    if (
      !parsedPreparation.success ||
      typeof persistedPreparationDigest !== "string" ||
      prArtifact.sha256 !== persistedPreparationDigest ||
      computePrPreparationDigest(parsedPreparation.data) !== persistedPreparationDigest ||
      parsedPreparation.data.binding.runId !== input.runId ||
      parsedPreparation.data.binding.prAttempt > prStep.attempt
    ) {
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason: "Typed PR preparation is required before PR creation.",
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }
    const preparation = parsedPreparation.data;
    const intent = preparation.intent;

    const matchingApprovals = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, prApprovalScope)));
    const approval = matchingApprovals.length === 1 ? matchingApprovals[0] : undefined;

    if (approval?.status !== "approved") {
      const blockedReason = "External write approval is required before PR creation.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "waiting_for_approval",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    if (
      requestedChangeDigest &&
      (approval.metadata as { prChangeDigest?: unknown } | null)?.prChangeDigest !==
        requestedChangeDigest
    ) {
      const blockedReason = "Approved evidence does not match the requested PR changes.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "blocked",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }
    if (
      (approval.metadata as { prIntentDigest?: unknown } | null)?.prIntentDigest !==
      persistedPreparationDigest
    ) {
      const blockedReason = "Approved evidence does not match the prepared PR intent.";
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: { ...(run.metadata ?? {}), blockedReason },
          status: "blocked",
        })
        .where(eq(loopRuns.id, input.runId));
      return {
        result: blockedPrStageResult({
          artifactId: prArtifact.id,
          blockedReason,
          mode: input.mode,
          runId: input.runId,
          stepId: prStep.id,
          traceId: prStep.traceId ?? run.traceId,
        }),
      };
    }

    const [claimedStep] = await tx
      .update(runSteps)
      .set({
        completedAt: null,
        metadata: {
          ...(prStep.metadata ?? {}),
          prIntentSchemaId: intent.schemaId,
          prPreparationResultSha256: persistedPreparationDigest,
        },
        startedAt: prStep.startedAt ?? occurredAt,
        status: "running",
        traceId: prStep.traceId ?? run.traceId,
      })
      .where(and(eq(runSteps.id, prStep.id), eq(runSteps.status, "queued")))
      .returning({ id: runSteps.id });
    if (!claimedStep) {
      throw new DevelopmentLoopTransitionError(
        `Run ${input.runId} PR step is already in progress or is not retryable.`,
      );
    }

    await tx
      .update(loopRuns)
      .set({
        currentStage: "pr",
        metadata: metadataWithoutBlockedReason(run.metadata),
        status: "running",
      })
      .where(eq(loopRuns.id, input.runId));
    const [claimedApproval] = await tx
      .update(approvals)
      .set({
        metadata: {
          ...(approval.metadata ?? {}),
          prWriteClaim: {
            claimedAt: occurredAt.toISOString(),
            changeDigest: requestedChangeDigest ?? null,
            intentDigest: persistedPreparationDigest,
            runId: input.runId,
          },
        },
      })
      .where(and(eq(approvals.id, approval.id), eq(approvals.status, "approved")))
      .returning({ id: approvals.id });
    if (!claimedApproval) {
      throw new DevelopmentLoopTransitionError(
        "External write approval changed before the PR stage could claim it.",
      );
    }

    return {
      approval,
      intent,
      preparation,
      preparationDigest: persistedPreparationDigest,
      loopKey: run.loopKey,
      prArtifact,
      prStep,
      repository: run,
    };
  });

  if ("result" in prepared && prepared.result) {
    const result = prepared.result;
    input.logger?.info(
      {
        blockedReason: result.blockedReason,
        idempotent: result.idempotent,
        mode: result.mode,
        runId: result.runId,
        stage: "pr",
        status: result.status,
        stepId: result.stepId,
        traceId: result.traceId,
      },
      result.status === "blocked"
        ? "development_loop_pr_transition_blocked"
        : "development_loop_pr_transition_replayed",
    );
    return result;
  }

  let pullRequest: GitHubPullRequestWriteResult | undefined;
  let completedAt = occurredAt;
  try {
    if (input.mode === "live") {
      if (!prepared.repository.installationId) {
        throw new Error("github_installation_missing");
      }
      pullRequest = await (input.writer ?? createGitHubPullRequest)({
        baseBranch: prepared.repository.defaultBranch,
        body: prepared.intent.body,
        changes: input.changes,
        commitMessage: input.commitMessage,
        draft: true,
        installationId: prepared.repository.installationId,
        owner: prepared.repository.repositoryOwner,
        repo: prepared.repository.repositoryName,
        runId: input.runId,
        title: prepared.intent.title,
      });
      if (
        !pullRequest?.url ||
        !pullRequest.headBranch ||
        !pullRequest.headSha ||
        !Number.isSafeInteger(pullRequest.number)
      ) {
        throw new Error("github_pr_result_invalid");
      }
    }

    completedAt = input.occurredAt ?? now();

    await input.database.transaction(async (tx) => {
      await tx
        .update(runSteps)
        .set({
          completedAt,
          metadata: {
            ...(prepared.prStep.metadata ?? {}),
            prIntentSchemaId: prepared.intent.schemaId,
            ...(pullRequest ? { githubPullRequestNumber: pullRequest.number } : {}),
          },
          status: "succeeded",
        })
        .where(eq(runSteps.id, prepared.prStep.id));
      await tx
        .update(artifacts)
        .set({
          metadata: {
            ...createPrIntentArtifactMetadata(prepared.intent),
            prPreparationResult: prepared.preparation,
            prPreparationResultSchemaId: prepared.preparation.schemaId,
            prPreparationResultSha256: prepared.preparationDigest,
            ...(pullRequest ? { githubPullRequest: pullRequest } : {}),
          },
          ...(pullRequest ? { uri: pullRequest.url } : {}),
        })
        .where(eq(artifacts.id, prepared.prArtifact.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "done",
          metadata: metadataWithoutPrFailure(prepared.repository.metadata),
          status: "running",
        })
        .where(eq(loopRuns.id, input.runId));
      const [appliedApproval] = await tx
        .update(approvals)
        .set({
          metadata: {
            ...approvalMetadataWithoutClaim(prepared.approval.metadata),
            appliedChangeDigest: requestedChangeDigest ?? null,
            appliedIntentDigest: prepared.preparationDigest,
          },
          status: "applied",
        })
        .where(and(eq(approvals.id, prepared.approval.id), eq(approvals.status, "approved")))
        .returning({ id: approvals.id });
      if (!appliedApproval) {
        throw new DevelopmentLoopTransitionError(
          "External write approval changed before PR finalization.",
        );
      }
      await tx.insert(approvalTransitionEvents).values({
        action: "apply",
        actorId:
          input.mode === "live" ? input.actorId : (prepared.approval.resolvedBy ?? "maintainer"),
        approvalId: prepared.approval.id,
        fromStatus: "approved",
        metadata: { mode: input.mode, stage: "pr" },
        note: "PR stage completed after guarded external-write approval.",
        occurredAt: completedAt,
        runId: input.runId,
        toStatus: "applied",
      });
    });
  } catch {
    const failedAt = input.occurredAt ?? now();
    await input.database.transaction(async (tx) => {
      await tx
        .update(runSteps)
        .set({
          completedAt: failedAt,
          metadata: {
            ...(prepared.prStep.metadata ?? {}),
            failure: { code: "github_pr_creation_failed", retryable: true },
            failureCode: "github_pr_creation_failed",
            retryable: true,
          },
          status: "failed",
        })
        .where(eq(runSteps.id, prepared.prStep.id));
      await tx
        .update(loopRuns)
        .set({
          currentStage: "pr",
          metadata: {
            ...(prepared.repository.metadata ?? {}),
            failureCode: "github_pr_creation_failed",
            retryable: true,
          },
          status: "failed",
        })
        .where(eq(loopRuns.id, input.runId));
      await tx
        .update(approvals)
        .set({ metadata: approvalMetadataWithoutClaim(prepared.approval.metadata) })
        .where(and(eq(approvals.id, prepared.approval.id), eq(approvals.status, "approved")));
    });
    emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
      durationSeconds: durationSecondsBetween(prepared.prStep.startedAt ?? occurredAt, failedAt),
      loopKey: prepared.loopKey,
      stage: "pr",
      status: "failed",
    });
    input.logger?.error(
      {
        failureCode: "github_pr_creation_failed",
        runId: input.runId,
        stage: "pr",
        stepId: prepared.prStep.id,
        traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined,
      },
      "development_loop_pr_transition_failed",
    );
    await scheduleDevelopmentLoopStageRetry({
      database: input.database,
      failure: { code: "github_pr_creation_failed", retryable: true },
      logger: input.logger,
      manifest: input.manifest ?? defaultLoopManifest,
      occurredAt: failedAt,
      runId: input.runId,
      stage: "pr",
      traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined,
    });
    throw new DevelopmentLoopTransitionError(
      "PR creation failed; the step is ready for inspection and retry.",
    );
  }

  emitSafely(input.metrics?.stepDuration ?? recordDevelopmentLoopStepDurationMetric, {
    durationSeconds: durationSecondsBetween(prepared.prStep.startedAt ?? occurredAt, completedAt),
    loopKey: prepared.loopKey,
    stage: "pr",
    status: "succeeded",
  });
  input.logger?.info(
    {
      mode: input.mode,
      pullRequestNumber: pullRequest?.number,
      runId: input.runId,
      stage: "pr",
      stepId: prepared.prStep.id,
      traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined,
    },
    "development_loop_pr_transition_persisted",
  );

  return {
    artifactId: prepared.prArtifact.id,
    mode: input.mode,
    ...(pullRequest ? { pullRequestUrl: pullRequest.url } : {}),
    runId: input.runId,
    stage: "pr",
    status: "advanced",
    stepId: prepared.prStep.id,
    ...((prepared.prStep.traceId ?? prepared.repository.traceId)
      ? { traceId: prepared.prStep.traceId ?? prepared.repository.traceId ?? undefined }
      : {}),
  };
}
