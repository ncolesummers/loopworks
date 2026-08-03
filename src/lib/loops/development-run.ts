import { randomUUID } from "node:crypto";
import { createImplementationArtifactContractMetadata } from "@agent/implementation-agent";
import { createPlanningAgentSeedPlan } from "@agent/planning-agent";
import {
  createRedTestEvidenceArtifactContractMetadata,
  createTestPlanArtifactContractMetadata,
} from "@agent/test-writing-agent";
import { createValidationReviewArtifactContractMetadata } from "@agent/validation-review-agent";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import {
  agentPlans,
  approvals,
  artifacts,
  idempotencyLocks,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createPrIntentArtifactContractMetadata } from "@/lib/loops/pr-intent";
import { createScreenshotEvidenceArtifactContractMetadata } from "@/lib/loops/screenshot-evidence";
import { createValidationReportArtifactContractMetadata } from "@/lib/loops/validation-report";
import { logger } from "@/lib/observability/logger";
import {
  recordDevelopmentLoopRunCreatedObservability,
  recordDevelopmentLoopStepRetryMetric,
  recordLockContentionMetric,
} from "@/lib/observability/metrics";
import {
  getActiveTraceId,
  isValidW3cTraceId,
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startDevelopmentLoopDispatchSpan,
} from "@/lib/observability/trace-context";
import type { ArtifactRecord, TimelineEvent, TimelineKind } from "@/lib/types";
import type { LoopManifest } from "../../../schemas/loop-manifest";

export const developmentLoopKey = "development-loop";
export const developmentLoopNoopEventType = "development_loop_noop";

export type DevelopmentLoopStageKey =
  | "planning"
  | "test-writing"
  | "development"
  | "validation"
  | "code-review"
  | "commit"
  | "pr"
  | "done";

export type DevelopmentLoopArtifactType =
  | "plan"
  | "validation_report"
  | "test_plan"
  | "patch"
  | "pr_intent"
  | "log_summary"
  | "screenshot"
  | "other";

type DevelopmentLoopArtifactContract = {
  label: string;
  required: true;
  type: DevelopmentLoopArtifactType;
};

type DevelopmentLoopStageContract = {
  actorId: string;
  actorType: "agent" | "ci" | "human" | "system";
  artifacts: readonly DevelopmentLoopArtifactContract[];
  key: DevelopmentLoopStageKey;
  summary: string;
  timelineKind: TimelineKind;
  title: string;
  validationCommand?: string;
  validationStatus?: string;
};

export const developmentLoopStages = [
  {
    actorId: "planning-agent",
    actorType: "agent",
    artifacts: [{ label: "Plan artifact", required: true, type: "plan" }],
    key: "planning",
    summary:
      "Create an issue-backed execution plan with acceptance criteria and validation mapping.",
    timelineKind: "planning",
    title: "Planning",
  },
  {
    actorId: "test-writer",
    actorType: "agent",
    artifacts: [
      { label: "Red test evidence", required: true, type: "validation_report" },
      { label: "Automated test plan", required: true, type: "test_plan" },
    ],
    key: "test-writing",
    summary: "Write focused failing tests before production code changes.",
    timelineKind: "test",
    title: "Test writing",
    validationCommand: "bun run test",
    validationStatus: "red",
  },
  {
    actorId: "implementer",
    actorType: "agent",
    artifacts: [{ label: "Patch artifact", required: true, type: "patch" }],
    key: "development",
    summary: "Implement the smallest green change for the issue scope.",
    timelineKind: "development",
    title: "Development",
  },
  {
    actorId: "ci-runner",
    actorType: "ci",
    artifacts: [
      { label: "Validation report", required: true, type: "validation_report" },
      { label: "Validation screenshots", required: true, type: "screenshot" },
    ],
    key: "validation",
    summary: "Run deterministic checks before review, LLM judgment, commit, or PR stages.",
    timelineKind: "validation",
    title: "Validation",
    validationCommand: "bun run validate",
    validationStatus: "required",
  },
  {
    actorId: "validation-reviewer",
    actorType: "agent",
    artifacts: [{ label: "Code review notes", required: true, type: "log_summary" }],
    key: "code-review",
    summary: "Review assumptions, security/a11y risks, and validation evidence.",
    timelineKind: "review",
    title: "Code review",
  },
  {
    actorId: "maintainer",
    actorType: "human",
    artifacts: [{ label: "Commit intent", required: true, type: "other" }],
    key: "commit",
    summary: "Prepare an atomic conventional commit only after validation and review.",
    timelineKind: "commit",
    title: "Commit",
  },
  {
    actorId: "pr-preparer",
    actorType: "agent",
    artifacts: [{ label: "PR intent", required: true, type: "pr_intent" }],
    key: "pr",
    summary: "Prepare PR metadata linking the source issue, run, and validation evidence.",
    timelineKind: "pull_request",
    title: "PR",
  },
  {
    actorId: "loopworks",
    actorType: "system",
    artifacts: [{ label: "Completion summary", required: true, type: "other" }],
    key: "done",
    summary: "Close the run only after deterministic validation and review evidence are present.",
    timelineKind: "done",
    title: "Done",
  },
] as const satisfies readonly DevelopmentLoopStageContract[];

export type DevelopmentLoopTrigger = {
  body?: string;
  deliveryId?: string;
  issueNumber: number;
  issueUrl?: string;
  labels?: readonly string[];
  milestone?: string | null;
  repositoryFullName: string;
  repositoryRevision?: {
    ref: string;
    commitSha: string;
  };
  title?: string | null;
};

export type DevelopmentLoopRunDatabase = Pick<typeof db, "transaction">;
export type DevelopmentLoopRunTransactionWriter = Parameters<
  Parameters<(typeof db)["transaction"]>[0]
>[0];

export type DevelopmentLoopRunMetadata =
  | DevelopmentLoopDispatchOutcome
  | {
      artifactCount: number;
      mode: "simulated";
      stageCount: number;
    };

export type DevelopmentLoopNoopMetadata = {
  mode: "noop";
  reason: "loop_disabled";
};

type DevelopmentLoopRunTransactionResult = {
  emitObservability?: () => void;
  metadata: DevelopmentLoopDispatchOutcome;
};

export type DevelopmentLoopDispatchOutcome =
  | {
      artifactCount: number;
      mode: "dispatched";
      runId: string;
      stageCount: number;
    }
  | {
      artifactCount: number;
      mode: "deferred";
      reason: "max_in_flight" | "not_due";
      runId: string;
      stageCount: number;
    }
  | {
      artifactCount: number;
      mode: "lease_contention";
      reason: "delivery_replay" | "issue_active";
      runId: string;
      stageCount: number;
    };

type DevelopmentLoopStageInstance = {
  actorId: string;
  actorType: string;
  artifacts: DevelopmentLoopArtifactInstance[];
  completedAt?: Date;
  key: DevelopmentLoopStageKey;
  queuedAt: Date;
  status: "queued";
  summary: string;
  timelineKind: TimelineKind;
  title: string;
  validationCommand?: string;
  validationStatus?: string;
};

type DevelopmentLoopArtifactInstance = {
  detail: string;
  label: string;
  required: true;
  stageKey: DevelopmentLoopStageKey;
  type: DevelopmentLoopArtifactType;
  uri: string;
};

export type DevelopmentLoopRunSkeleton = {
  artifacts: DevelopmentLoopArtifactInstance[];
  loopKey: typeof developmentLoopKey;
  mode: "created" | "simulated";
  runId?: string;
  stages: DevelopmentLoopStageInstance[];
  trigger: DevelopmentLoopTrigger;
};

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function getIssueUrl(trigger: DevelopmentLoopTrigger): string {
  if (trigger.issueUrl?.trim()) {
    return trigger.issueUrl.trim();
  }

  return `https://github.com/${trigger.repositoryFullName}/issues/${trigger.issueNumber}`;
}

function getArtifactUri(
  trigger: DevelopmentLoopTrigger,
  stage: DevelopmentLoopStageContract,
  artifact: DevelopmentLoopArtifactContract,
) {
  const suffix =
    artifact.type === "validation_report"
      ? artifact.label.toLowerCase().replaceAll(" ", "-")
      : artifact.type.replaceAll("_", "-");
  return `${getIssueUrl(trigger)}#development-loop-${stage.key}-${suffix}`;
}

function formatTimelineTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function getArtifactKind(type: DevelopmentLoopArtifactType): ArtifactRecord["kind"] {
  if (type === "validation_report") {
    return "validation";
  }

  if (type === "pr_intent" || type === "log_summary") {
    return "review";
  }

  return "log";
}

export function createDevelopmentLoopRunSkeleton(input: {
  mode: "created" | "simulated";
  now: Date;
  runId?: string;
  trigger: DevelopmentLoopTrigger;
}): DevelopmentLoopRunSkeleton {
  const stages = developmentLoopStages.map((stageDefinition, index) => {
    const stage: DevelopmentLoopStageContract = stageDefinition;
    const stageArtifacts = stage.artifacts.map((artifact) => ({
      detail: stage.summary,
      label: artifact.label,
      required: artifact.required,
      stageKey: stage.key,
      type: artifact.type,
      uri: getArtifactUri(input.trigger, stage, artifact),
    }));

    return {
      actorId: stage.actorId,
      actorType: stage.actorType,
      artifacts: stageArtifacts,
      key: stage.key,
      queuedAt: minutesAfter(input.now, index),
      status: "queued" as const,
      summary: stage.summary,
      timelineKind: stage.timelineKind,
      title: stage.title,
      ...(stage.validationCommand ? { validationCommand: stage.validationCommand } : {}),
      ...(stage.validationStatus ? { validationStatus: stage.validationStatus } : {}),
    };
  });

  return {
    artifacts: stages.flatMap((stage) => stage.artifacts),
    loopKey: developmentLoopKey,
    mode: input.mode,
    ...(input.runId ? { runId: input.runId } : {}),
    stages,
    trigger: input.trigger,
  };
}

export function projectDevelopmentLoopTimeline(
  skeleton: DevelopmentLoopRunSkeleton,
): TimelineEvent[] {
  return skeleton.stages.map((stage) => ({
    actor: stage.actorId,
    artifact: stage.artifacts.map((artifact) => artifact.label).join(", "),
    at: formatTimelineTime(stage.queuedAt),
    detail: stage.summary,
    kind: stage.timelineKind,
    title: stage.title,
  }));
}

export function projectDevelopmentLoopArtifacts(
  skeleton: DevelopmentLoopRunSkeleton,
): ArtifactRecord[] {
  return skeleton.artifacts.map((artifact) => ({
    detail: artifact.detail,
    href: artifact.uri,
    kind: getArtifactKind(artifact.type),
    label: artifact.label,
    state: "available",
  }));
}

export function simulateDevelopmentLoopRun(input: {
  now: Date;
  trigger: DevelopmentLoopTrigger;
}): DevelopmentLoopRunMetadata {
  const skeleton = createDevelopmentLoopRunSkeleton({
    mode: "simulated",
    now: input.now,
    trigger: input.trigger,
  });

  return {
    artifactCount: skeleton.artifacts.length,
    mode: "simulated",
    stageCount: skeleton.stages.length,
  };
}

function getDevelopmentLoopManifest(manifest: LoopManifest) {
  const loop = manifest.loops.find(({ key }) => key === developmentLoopKey);
  if (!loop) {
    throw new Error(`Manifest does not define ${developmentLoopKey}.`);
  }
  return loop;
}

export function resolveDevelopmentLoopConcurrencyGroup(input: {
  manifest: LoopManifest;
  repositoryFullName: string;
}): string {
  const template = getDevelopmentLoopManifest(input.manifest).concurrency.group;
  const resolved = template.replaceAll("{repo}", input.repositoryFullName);
  const unresolved = resolved.match(/\{[^}]+\}/)?.[0];
  if (unresolved) {
    throw new Error(`Unsupported concurrency group placeholder: ${unresolved}`);
  }
  return resolved;
}

export function calculateDevelopmentLoopRetryDelaySeconds(input: {
  backoff: {
    initialSeconds: number;
    maxSeconds: number;
    strategy: "exponential" | "fixed";
  };
  completedAttempt: number;
}): number {
  const delay =
    input.backoff.strategy === "fixed"
      ? input.backoff.initialSeconds
      : input.backoff.initialSeconds * 2 ** Math.max(0, input.completedAttempt - 1);
  return Math.min(delay, input.backoff.maxSeconds);
}

function dispatchGroupGuardKey(group: string): string {
  return `loop:dispatch:group-guard:${group}`;
}

export async function dispatchDevelopmentLoopRun(input: {
  clock: () => Date;
  database: DevelopmentLoopRunDatabase;
  manifest: LoopManifest;
  observability?: {
    recordLockContentionMetric?: typeof recordLockContentionMetric;
  };
  retry?: {
    attempt: number;
    eligibleAt: Date;
    retryOfRunId: string;
    rootRunId: string;
  };
  traceId?: string;
  trigger: DevelopmentLoopTrigger;
}): Promise<DevelopmentLoopDispatchOutcome> {
  const createdAt = input.clock();
  const loopManifest = getDevelopmentLoopManifest(input.manifest);
  const resolvedGroup = resolveDevelopmentLoopConcurrencyGroup({
    manifest: input.manifest,
    repositoryFullName: input.trigger.repositoryFullName,
  });
  const traceId =
    input.traceId === undefined
      ? getActiveTraceId()
      : isValidW3cTraceId(input.traceId)
        ? input.traceId
        : undefined;
  const dispatchSpan = startDevelopmentLoopDispatchSpan({ traceId });

  const result: DevelopmentLoopRunTransactionResult = await input.database
    .transaction(async (tx) => {
      const existingRun = input.trigger.deliveryId
        ? await tx
            .select({ id: loopRuns.id })
            .from(loopRuns)
            .where(
              and(
                eq(loopRuns.loopKey, developmentLoopKey),
                sql`${loopRuns.metadata}->>'deliveryId' = ${input.trigger.deliveryId}`,
              ),
            )
            .limit(1)
        : [];

      if (existingRun[0]) {
        const existingArtifacts = await tx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(eq(artifacts.runId, existingRun[0].id));
        const existingSteps = await tx
          .select({ id: runSteps.id })
          .from(runSteps)
          .where(eq(runSteps.runId, existingRun[0].id));

        return {
          metadata: {
            artifactCount: existingArtifacts.length,
            mode: "lease_contention" as const,
            reason: "delivery_replay" as const,
            runId: existingRun[0].id,
            stageCount: existingSteps.length,
          },
        };
      }

      const [repository] = await tx
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.fullName, input.trigger.repositoryFullName))
        .limit(1);

      if (!repository) {
        throw new Error(
          `Cannot create development loop run for unknown repository: ${input.trigger.repositoryFullName}`,
        );
      }

      const guardKey = dispatchGroupGuardKey(resolvedGroup);
      await tx
        .insert(idempotencyLocks)
        .values({
          acquiredAt: createdAt,
          expiresAt: createdAt,
          key: guardKey,
          owner: "loopworks:dispatch-admission",
          releasedAt: createdAt,
          scope: "loop:dispatch:group-guard",
          status: "released",
        })
        .onConflictDoNothing({ target: idempotencyLocks.key });

      const [guard] = await tx
        .select({ id: idempotencyLocks.id })
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.key, guardKey))
        .for("update");
      if (!guard) {
        throw new Error(`Dispatch group guard ${guardKey} could not be locked.`);
      }

      const issueGuardKey = `loop:dispatch:issue-guard:${repository.id}:${input.trigger.issueNumber}`;
      await tx
        .insert(idempotencyLocks)
        .values({
          acquiredAt: createdAt,
          expiresAt: createdAt,
          key: issueGuardKey,
          owner: "loopworks:dispatch-admission",
          releasedAt: createdAt,
          scope: "loop:dispatch:issue-guard",
          status: "released",
        })
        .onConflictDoNothing({ target: idempotencyLocks.key });
      const [issueGuard] = await tx
        .select({ id: idempotencyLocks.id })
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.key, issueGuardKey))
        .for("update");
      if (!issueGuard) {
        throw new Error(`Dispatch issue guard ${issueGuardKey} could not be locked.`);
      }

      const activeRun = await tx
        .select({ id: loopRuns.id })
        .from(loopRuns)
        .where(
          and(
            eq(loopRuns.repositoryId, repository.id),
            eq(loopRuns.githubIssueNumber, input.trigger.issueNumber),
            sql`(${loopRuns.status} in ('queued', 'running', 'waiting_for_approval', 'blocked') or (${loopRuns.status} = 'failed' and ${loopRuns.completedAt} is null))`,
          ),
        )
        .limit(1);

      if (activeRun[0]) {
        const existingArtifacts = await tx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(eq(artifacts.runId, activeRun[0].id));
        const existingSteps = await tx
          .select({ id: runSteps.id })
          .from(runSteps)
          .where(eq(runSteps.runId, activeRun[0].id));
        return {
          metadata: {
            artifactCount: existingArtifacts.length,
            mode: "lease_contention" as const,
            reason: "issue_active" as const,
            runId: activeRun[0].id,
            stageCount: existingSteps.length,
          },
        };
      }

      const [capacity] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(idempotencyLocks)
        .where(
          and(
            eq(idempotencyLocks.scope, resolvedGroup),
            eq(idempotencyLocks.status, "acquired"),
            isNotNull(idempotencyLocks.runId),
          ),
        );
      const isDue = !input.retry || input.retry.eligibleAt.getTime() <= createdAt.getTime();
      const shouldAcquireLease =
        isDue && Number(capacity?.count ?? 0) < loopManifest.concurrency.maxInFlight;

      const runId = randomUUID();
      const queuedAt = input.retry?.eligibleAt ?? createdAt;
      const skeleton = createDevelopmentLoopRunSkeleton({
        mode: "created",
        now: queuedAt,
        runId,
        trigger: input.trigger,
      });

      await tx.insert(loopRuns).values({
        id: runId,
        currentStage: developmentLoopStages[0].key,
        githubIssueNumber: input.trigger.issueNumber,
        githubIssueUrl: getIssueUrl(input.trigger),
        loopKey: skeleton.loopKey,
        metadata: {
          dispatchAttempt: input.retry?.attempt ?? 1,
          deliveryId: input.trigger.deliveryId,
          labels: input.trigger.labels ?? [],
          milestone: input.trigger.milestone ?? null,
          issueTitle: input.trigger.title ?? `Issue #${input.trigger.issueNumber}`,
          retryOfRunId: input.retry?.retryOfRunId ?? null,
          rootRunId: input.retry?.rootRunId ?? runId,
          source: "github_issue",
          stageCount: skeleton.stages.length,
          triggerSnapshot: {
            body: input.trigger.body,
            issueNumber: input.trigger.issueNumber,
            issueUrl: getIssueUrl(input.trigger),
            labels: input.trigger.labels ?? [],
            milestone: input.trigger.milestone ?? null,
            repositoryFullName: input.trigger.repositoryFullName,
            repositoryRevision: input.trigger.repositoryRevision,
            title: input.trigger.title ?? null,
          },
        },
        queuedAt,
        repositoryId: repository.id,
        status: "queued",
        traceId,
      });

      const stepIdsByStage = new Map<DevelopmentLoopStageKey, string>();
      for (const stage of skeleton.stages) {
        const stepId = randomUUID();
        stepIdsByStage.set(stage.key, stepId);
        await tx.insert(runSteps).values({
          id: stepId,
          actorId: stage.actorId,
          actorType: stage.actorType,
          metadata: {
            artifactLabels: stage.artifacts.map((artifact) => artifact.label),
            requiredArtifacts: stage.artifacts.every((artifact) => artifact.required),
          },
          queuedAt: stage.queuedAt,
          runId,
          stage: stage.key,
          status: stage.status,
          summary: stage.summary,
          traceId,
          validationCommand: stage.validationCommand,
          validationStatus: stage.validationStatus,
        });
      }

      await tx.insert(artifacts).values(
        skeleton.artifacts.map((artifact) => ({
          id: randomUUID(),
          metadata: {
            required: artifact.required,
            stage: artifact.stageKey,
            ...(artifact.type === "validation_report" && artifact.stageKey === "validation"
              ? createValidationReportArtifactContractMetadata({
                  detail: artifact.detail,
                })
              : {}),
            ...(artifact.type === "validation_report" && artifact.stageKey === "test-writing"
              ? createRedTestEvidenceArtifactContractMetadata()
              : {}),
            ...(artifact.type === "test_plan" ? createTestPlanArtifactContractMetadata() : {}),
            ...(artifact.type === "patch" ? createImplementationArtifactContractMetadata() : {}),
            ...(artifact.type === "screenshot"
              ? createScreenshotEvidenceArtifactContractMetadata()
              : {}),
            ...(artifact.type === "log_summary" && artifact.stageKey === "code-review"
              ? createValidationReviewArtifactContractMetadata()
              : {}),
            ...(artifact.type === "pr_intent" ? createPrIntentArtifactContractMetadata() : {}),
          },
          runId,
          stepId: stepIdsByStage.get(artifact.stageKey),
          title: artifact.label,
          type: artifact.type,
          uri: artifact.uri,
        })),
      );

      const planId = randomUUID();
      const plan = createPlanningAgentSeedPlan({
        body: input.trigger.body ?? "",
        issueNumber: input.trigger.issueNumber,
        issueUrl: getIssueUrl(input.trigger),
        labels: [...(input.trigger.labels ?? [])],
        milestone: input.trigger.milestone ?? null,
        repositoryFullName: input.trigger.repositoryFullName,
        repositoryRevision: input.trigger.repositoryRevision ?? null,
        title: input.trigger.title ?? `Issue #${input.trigger.issueNumber}`,
      });

      await tx.insert(agentPlans).values({
        id: planId,
        agentName: "planner",
        input: {
          issueNumber: input.trigger.issueNumber,
          labels: input.trigger.labels ?? [],
          milestone: input.trigger.milestone ?? null,
          repositoryFullName: input.trigger.repositoryFullName,
          title: input.trigger.title ?? "",
        },
        issueNumber: input.trigger.issueNumber,
        plan,
        runId,
        status: "pending",
      });

      if (plan.repositoryRevision) {
        await tx.insert(approvals).values({
          metadata: {
            planId,
            planSha256: plan.identity.sha256,
          },
          requestedBy: "planner",
          runId,
          scope: "plan-review",
          status: "requested",
        });
      }

      const emitObservability = await recordDevelopmentLoopRunCreatedObservability({
        artifactCount: skeleton.artifacts.length,
        deliveryId: input.trigger.deliveryId,
        issueNumber: input.trigger.issueNumber,
        loopKey: skeleton.loopKey,
        repositoryFullName: input.trigger.repositoryFullName,
        repositoryId: repository.id,
        runId,
        stageCount: skeleton.stages.length,
        traceId,
        triggerLabel: "agent-ready",
        writer: tx,
      });

      if (shouldAcquireLease) {
        await tx.insert(idempotencyLocks).values({
          acquiredAt: createdAt,
          expiresAt: minutesAfter(createdAt, loopManifest.budgets.maxRunMinutes),
          key: `loop:dispatch:lease:${runId}`,
          metadata: {
            loopKey: developmentLoopKey,
          },
          owner: runId,
          runId,
          scope: resolvedGroup,
          status: "acquired",
          traceId,
        });
      }

      const metadata: DevelopmentLoopDispatchOutcome = shouldAcquireLease
        ? {
            artifactCount: skeleton.artifacts.length,
            mode: "dispatched",
            runId,
            stageCount: skeleton.stages.length,
          }
        : {
            artifactCount: skeleton.artifacts.length,
            mode: "deferred",
            reason: isDue ? "max_in_flight" : "not_due",
            runId,
            stageCount: skeleton.stages.length,
          };
      return { emitObservability, metadata };
    })
    .catch((error) => {
      markLoopworksSpanError(dispatchSpan.span, error);
      dispatchSpan.span.end();
      throw error;
    });

  try {
    result.emitObservability?.();
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : "unknown", loopKey: developmentLoopKey },
      "development_loop_dispatch_observability_failed",
    );
  }

  if (result.metadata.mode === "lease_contention" && result.metadata.reason === "issue_active") {
    try {
      (input.observability?.recordLockContentionMetric ?? recordLockContentionMetric)({
        scope: "loop:dispatch",
      });
    } catch {
      // Durable admission must not depend on the telemetry sink.
    }
    logger.info(
      {
        issueNumber: input.trigger.issueNumber,
        loopKey: developmentLoopKey,
        runId: result.metadata.runId,
      },
      "development_loop_dispatch_lease_contended",
    );
  } else if (result.metadata.mode === "deferred") {
    logger.info(
      {
        issueNumber: input.trigger.issueNumber,
        loopKey: developmentLoopKey,
        runId: result.metadata.runId,
      },
      "development_loop_dispatch_deferred",
    );
  }

  dispatchSpan.setOutcome(result.metadata.mode);
  markLoopworksSpanOk(dispatchSpan.span);
  dispatchSpan.span.end();
  return result.metadata;
}

export async function drainDevelopmentLoopDispatchQueue(input: {
  clock: () => Date;
  database: DevelopmentLoopRunDatabase;
  manifest: LoopManifest;
  repositoryFullName?: string;
}): Promise<Array<{ mode: "dispatched"; runId: string; traceId?: string }>> {
  const now = input.clock();
  const loopManifest = getDevelopmentLoopManifest(input.manifest);

  const promoted = await input.database.transaction(async (tx) => {
    const candidates = await tx
      .select({
        issueNumber: loopRuns.githubIssueNumber,
        metadata: loopRuns.metadata,
        repositoryFullName: repositories.fullName,
        repositoryId: loopRuns.repositoryId,
        runId: loopRuns.id,
        traceId: loopRuns.traceId,
      })
      .from(loopRuns)
      .innerJoin(repositories, eq(loopRuns.repositoryId, repositories.id))
      .where(
        and(
          eq(loopRuns.loopKey, developmentLoopKey),
          eq(loopRuns.status, "queued"),
          isNull(loopRuns.completedAt),
          lte(loopRuns.queuedAt, now),
          ...(input.repositoryFullName
            ? [eq(repositories.fullName, input.repositoryFullName)]
            : []),
        ),
      )
      .orderBy(asc(loopRuns.queuedAt), asc(loopRuns.githubIssueNumber));

    const outcomes: Array<{
      mode: "dispatched";
      retryMetric?: { reason: string; stage: string };
      runId: string;
      traceId?: string;
    }> = [];
    for (const candidate of candidates) {
      if (candidate.issueNumber === null) continue;
      const resolvedGroup = resolveDevelopmentLoopConcurrencyGroup({
        manifest: input.manifest,
        repositoryFullName: candidate.repositoryFullName,
      });
      const guardKey = dispatchGroupGuardKey(resolvedGroup);
      await tx
        .insert(idempotencyLocks)
        .values({
          acquiredAt: now,
          expiresAt: now,
          key: guardKey,
          owner: "loopworks:dispatch-admission",
          releasedAt: now,
          scope: "loop:dispatch:group-guard",
          status: "released",
        })
        .onConflictDoNothing({ target: idempotencyLocks.key });
      const [guard] = await tx
        .select({ id: idempotencyLocks.id })
        .from(idempotencyLocks)
        .where(eq(idempotencyLocks.key, guardKey))
        .for("update");
      if (!guard) {
        throw new Error(`Dispatch group guard ${guardKey} could not be locked.`);
      }

      const [existingLease] = await tx
        .select({ id: idempotencyLocks.id })
        .from(idempotencyLocks)
        .where(
          and(eq(idempotencyLocks.runId, candidate.runId), eq(idempotencyLocks.status, "acquired")),
        )
        .limit(1);
      if (existingLease) continue;

      const [capacity] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(idempotencyLocks)
        .where(
          and(
            eq(idempotencyLocks.scope, resolvedGroup),
            eq(idempotencyLocks.status, "acquired"),
            isNotNull(idempotencyLocks.runId),
          ),
        );
      if (Number(capacity?.count ?? 0) >= loopManifest.concurrency.maxInFlight) continue;

      const [reacquired] = await tx
        .update(idempotencyLocks)
        .set({
          acquiredAt: now,
          expiresAt: minutesAfter(now, loopManifest.budgets.maxRunMinutes),
          releasedAt: null,
          scope: resolvedGroup,
          status: "acquired",
          traceId: candidate.traceId,
        })
        .where(
          and(
            eq(idempotencyLocks.runId, candidate.runId),
            eq(idempotencyLocks.owner, candidate.runId),
            eq(idempotencyLocks.status, "released"),
          ),
        )
        .returning({ id: idempotencyLocks.id });
      if (!reacquired) {
        await tx.insert(idempotencyLocks).values({
          acquiredAt: now,
          expiresAt: minutesAfter(now, loopManifest.budgets.maxRunMinutes),
          key: `loop:dispatch:lease:${candidate.runId}`,
          metadata: { loopKey: developmentLoopKey },
          owner: candidate.runId,
          runId: candidate.runId,
          scope: resolvedGroup,
          status: "acquired",
          traceId: candidate.traceId,
        });
      }
      const runMetadata = (candidate.metadata ?? {}) as Record<string, unknown>;
      const scheduledRetry =
        runMetadata.scheduledRetry && typeof runMetadata.scheduledRetry === "object"
          ? (runMetadata.scheduledRetry as Record<string, unknown>)
          : undefined;
      let retryMetric: { reason: string; stage: string } | undefined;
      if (
        scheduledRetry &&
        typeof scheduledRetry.stage === "string" &&
        typeof scheduledRetry.completedAttempt === "number" &&
        typeof scheduledRetry.stepAttempt === "number"
      ) {
        const [failedStep] = await tx
          .select()
          .from(runSteps)
          .where(
            and(
              eq(runSteps.runId, candidate.runId),
              eq(runSteps.stage, scheduledRetry.stage),
              eq(runSteps.status, "failed"),
              eq(runSteps.attempt, scheduledRetry.stepAttempt),
            ),
          )
          .limit(1);
        if (failedStep) {
          const failedStepMetadata = (failedStep.metadata ?? {}) as Record<string, unknown>;
          const attemptHistory = Array.isArray(failedStepMetadata.attemptHistory)
            ? failedStepMetadata.attemptHistory
            : [];
          await tx
            .update(runSteps)
            .set({
              attempt: failedStep.attempt + 1,
              completedAt: null,
              metadata: {
                ...failedStepMetadata,
                attemptHistory: [
                  ...attemptHistory,
                  {
                    attempt: failedStep.attempt,
                    completedAt: failedStep.completedAt?.toISOString() ?? null,
                    failure: failedStepMetadata.failure ?? null,
                    status: "failed",
                  },
                ],
                promotedAt: now.toISOString(),
              },
              queuedAt: now,
              startedAt: null,
              status: "queued",
              traceId: failedStep.traceId ?? candidate.traceId,
            })
            .where(eq(runSteps.id, failedStep.id));
          await tx
            .update(loopRuns)
            .set({
              metadata: {
                ...runMetadata,
                dispatchAttempt: Math.max(
                  typeof runMetadata.dispatchAttempt === "number" ? runMetadata.dispatchAttempt : 1,
                  scheduledRetry.completedAttempt + 1,
                ),
                scheduledRetry: {
                  ...scheduledRetry,
                  promotedAt: now.toISOString(),
                },
              },
            })
            .where(eq(loopRuns.id, candidate.runId));
          retryMetric = {
            reason:
              typeof scheduledRetry.reason === "string" ? scheduledRetry.reason : "unspecified",
            stage: scheduledRetry.stage,
          };
        }
      }
      outcomes.push({
        mode: "dispatched",
        ...(retryMetric ? { retryMetric } : {}),
        runId: candidate.runId,
        ...(candidate.traceId ? { traceId: candidate.traceId } : {}),
      });
    }
    return outcomes;
  });

  for (const outcome of promoted) {
    if (outcome.retryMetric) {
      try {
        recordDevelopmentLoopStepRetryMetric({
          loopKey: developmentLoopKey,
          ...outcome.retryMetric,
        });
      } catch {
        // Durable retry promotion must not depend on the telemetry sink.
      }
    }
    logger.info(
      { loopKey: developmentLoopKey, runId: outcome.runId },
      "development_loop_dispatch_promoted",
    );
  }
  return promoted.map(({ retryMetric: _retryMetric, ...outcome }) => outcome);
}

type StoredTriggerSnapshot = {
  body?: string;
  issueNumber: number;
  issueUrl?: string;
  labels?: readonly string[];
  milestone?: string | null;
  repositoryFullName: string;
  repositoryRevision?: { commitSha: string; ref: string };
  title?: string | null;
};

function storedTriggerSnapshot(value: unknown): StoredTriggerSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const snapshot = value as Partial<StoredTriggerSnapshot>;
  if (typeof snapshot.issueNumber !== "number" || typeof snapshot.repositoryFullName !== "string") {
    return undefined;
  }
  return snapshot as StoredTriggerSnapshot;
}

export async function insertLinkedDevelopmentLoopRetryInTransaction(input: {
  manifest: LoopManifest;
  occurredAt: Date;
  reason: "stalled" | "timed_out";
  repository: { fullName: string; id: string };
  sourceMetadata: unknown;
  sourceRunId: string;
  traceId?: string;
  writer: DevelopmentLoopRunTransactionWriter;
}): Promise<{ eligibleAt: Date; emitObservability: () => void; runId: string } | undefined> {
  const loopManifest = getDevelopmentLoopManifest(input.manifest);
  const metadata = (input.sourceMetadata ?? {}) as Record<string, unknown>;
  const completedAttempt =
    typeof metadata.dispatchAttempt === "number" ? metadata.dispatchAttempt : 1;
  if (completedAttempt >= loopManifest.retryPolicy.maxAttempts) return undefined;
  const snapshot = storedTriggerSnapshot(metadata.triggerSnapshot);
  if (!snapshot) return undefined;

  const eligibleAt = new Date(
    input.occurredAt.getTime() +
      calculateDevelopmentLoopRetryDelaySeconds({
        backoff: loopManifest.retryPolicy.backoff,
        completedAttempt,
      }) *
        1_000,
  );
  const runId = randomUUID();
  const trigger: DevelopmentLoopTrigger = {
    ...snapshot,
    deliveryId: `loopworks-retry:${input.sourceRunId}:${completedAttempt + 1}`,
  };
  const skeleton = createDevelopmentLoopRunSkeleton({
    mode: "created",
    now: input.occurredAt,
    runId,
    trigger,
  });
  await input.writer.insert(loopRuns).values({
    id: runId,
    currentStage: developmentLoopStages[0].key,
    githubIssueNumber: trigger.issueNumber,
    githubIssueUrl: getIssueUrl(trigger),
    loopKey: developmentLoopKey,
    metadata: {
      dispatchAttempt: completedAttempt + 1,
      deliveryId: trigger.deliveryId,
      issueTitle: trigger.title ?? `Issue #${trigger.issueNumber}`,
      labels: trigger.labels ?? [],
      milestone: trigger.milestone ?? null,
      retryOfRunId: input.sourceRunId,
      rootRunId: typeof metadata.rootRunId === "string" ? metadata.rootRunId : input.sourceRunId,
      source: "github_issue",
      stageCount: skeleton.stages.length,
      triggerSnapshot: snapshot,
    },
    queuedAt: eligibleAt,
    repositoryId: input.repository.id,
    status: "queued",
    traceId: input.traceId,
  });

  const stepIdsByStage = new Map<DevelopmentLoopStageKey, string>();
  for (const stage of skeleton.stages) {
    const stepId = randomUUID();
    stepIdsByStage.set(stage.key, stepId);
    await input.writer.insert(runSteps).values({
      id: stepId,
      actorId: stage.actorId,
      actorType: stage.actorType,
      metadata: {
        artifactLabels: stage.artifacts.map((artifact) => artifact.label),
        requiredArtifacts: stage.artifacts.every((artifact) => artifact.required),
      },
      queuedAt: stage.queuedAt,
      runId,
      stage: stage.key,
      status: stage.status,
      summary: stage.summary,
      traceId: input.traceId,
      validationCommand: stage.validationCommand,
      validationStatus: stage.validationStatus,
    });
  }
  await input.writer.insert(artifacts).values(
    skeleton.artifacts.map((artifact) => ({
      id: randomUUID(),
      metadata: {
        required: artifact.required,
        stage: artifact.stageKey,
        ...(artifact.type === "validation_report" && artifact.stageKey === "validation"
          ? createValidationReportArtifactContractMetadata({ detail: artifact.detail })
          : {}),
        ...(artifact.type === "validation_report" && artifact.stageKey === "test-writing"
          ? createRedTestEvidenceArtifactContractMetadata()
          : {}),
        ...(artifact.type === "test_plan" ? createTestPlanArtifactContractMetadata() : {}),
        ...(artifact.type === "patch" ? createImplementationArtifactContractMetadata() : {}),
        ...(artifact.type === "screenshot"
          ? createScreenshotEvidenceArtifactContractMetadata()
          : {}),
        ...(artifact.type === "log_summary" && artifact.stageKey === "code-review"
          ? createValidationReviewArtifactContractMetadata()
          : {}),
        ...(artifact.type === "pr_intent" ? createPrIntentArtifactContractMetadata() : {}),
      },
      runId,
      stepId: stepIdsByStage.get(artifact.stageKey),
      title: artifact.label,
      type: artifact.type,
      uri: artifact.uri,
    })),
  );

  const planId = randomUUID();
  const plan = createPlanningAgentSeedPlan({
    body: trigger.body ?? "",
    issueNumber: trigger.issueNumber,
    issueUrl: getIssueUrl(trigger),
    labels: [...(trigger.labels ?? [])],
    milestone: trigger.milestone ?? null,
    repositoryFullName: trigger.repositoryFullName,
    repositoryRevision: trigger.repositoryRevision ?? null,
    title: trigger.title ?? `Issue #${trigger.issueNumber}`,
  });
  await input.writer.insert(agentPlans).values({
    id: planId,
    agentName: "planner",
    input: {
      issueNumber: trigger.issueNumber,
      labels: trigger.labels ?? [],
      milestone: trigger.milestone ?? null,
      repositoryFullName: trigger.repositoryFullName,
      title: trigger.title ?? "",
    },
    issueNumber: trigger.issueNumber,
    plan,
    runId,
    status: "pending",
  });
  if (plan.repositoryRevision) {
    await input.writer.insert(approvals).values({
      metadata: { planId, planSha256: plan.identity.sha256 },
      requestedBy: "planner",
      runId,
      scope: "plan-review",
      status: "requested",
    });
  }
  const emitObservability = await recordDevelopmentLoopRunCreatedObservability({
    artifactCount: skeleton.artifacts.length,
    deliveryId: trigger.deliveryId,
    issueNumber: trigger.issueNumber,
    loopKey: developmentLoopKey,
    repositoryFullName: input.repository.fullName,
    repositoryId: input.repository.id,
    runId,
    stageCount: skeleton.stages.length,
    traceId: input.traceId,
    triggerLabel: "agent-ready",
    writer: input.writer,
  });
  return { eligibleAt, emitObservability, runId };
}

export async function createLinkedDevelopmentLoopRetry(input: {
  clock: () => Date;
  database: DevelopmentLoopRunDatabase;
  manifest: LoopManifest;
  reason: "stalled" | "timed_out";
  sourceRunId: string;
}): Promise<DevelopmentLoopDispatchOutcome | undefined> {
  const loopManifest = getDevelopmentLoopManifest(input.manifest);
  const source = await input.database.transaction(async (tx) => {
    const [run] = await tx
      .select({ metadata: loopRuns.metadata, traceId: loopRuns.traceId })
      .from(loopRuns)
      .where(eq(loopRuns.id, input.sourceRunId))
      .limit(1);
    return run;
  });
  if (!source) return undefined;
  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
  const completedAttempt =
    typeof metadata.dispatchAttempt === "number" ? metadata.dispatchAttempt : 1;
  if (completedAttempt >= loopManifest.retryPolicy.maxAttempts) {
    logger.info(
      { loopKey: developmentLoopKey, reason: input.reason, runId: input.sourceRunId },
      "development_loop_retry_exhausted",
    );
    return undefined;
  }
  const triggerSnapshot = storedTriggerSnapshot(metadata.triggerSnapshot);
  if (!triggerSnapshot) {
    logger.error(
      { loopKey: developmentLoopKey, reason: "missing_trigger_snapshot", runId: input.sourceRunId },
      "development_loop_retry_exhausted",
    );
    return undefined;
  }
  const delaySeconds = calculateDevelopmentLoopRetryDelaySeconds({
    backoff: loopManifest.retryPolicy.backoff,
    completedAttempt,
  });
  const eligibleAt = new Date(input.clock().getTime() + delaySeconds * 1_000);
  const rootRunId = typeof metadata.rootRunId === "string" ? metadata.rootRunId : input.sourceRunId;
  const outcome = await dispatchDevelopmentLoopRun({
    clock: input.clock,
    database: input.database,
    manifest: input.manifest,
    retry: {
      attempt: completedAttempt + 1,
      eligibleAt,
      retryOfRunId: input.sourceRunId,
      rootRunId,
    },
    traceId: source.traceId ?? undefined,
    trigger: {
      ...triggerSnapshot,
      deliveryId: `loopworks-retry:${input.sourceRunId}:${completedAttempt + 1}`,
    },
  });
  logger.info(
    {
      attempt: completedAttempt + 1,
      loopKey: developmentLoopKey,
      reason: input.reason,
      runId: outcome.runId,
    },
    "development_loop_retry_scheduled",
  );
  return outcome;
}

export function runDevelopmentLoopRetrySupervisorTick(input: {
  clock: () => Date;
  database: DevelopmentLoopRunDatabase;
  manifest: LoopManifest;
}) {
  return drainDevelopmentLoopDispatchQueue(input);
}

export async function createDevelopmentLoopRun(input: {
  database: DevelopmentLoopRunDatabase;
  now?: () => Date;
  traceId?: string;
  trigger: DevelopmentLoopTrigger;
}): Promise<DevelopmentLoopDispatchOutcome> {
  const result = await dispatchDevelopmentLoopRun({
    clock: input.now ?? (() => new Date()),
    database: input.database,
    manifest: defaultLoopManifest,
    traceId: input.traceId,
    trigger: input.trigger,
  });

  return result;
}

export async function recordDevelopmentLoopNoop(input: {
  database: DevelopmentLoopRunDatabase;
  now?: () => Date;
  reason: "loop_disabled";
  trigger: DevelopmentLoopTrigger;
}): Promise<DevelopmentLoopNoopMetadata> {
  const createdAt = input.now?.() ?? new Date();

  await input.database.transaction(async (tx) => {
    const existingNoop = input.trigger.deliveryId
      ? await tx
          .select({ id: observabilityEvents.id })
          .from(observabilityEvents)
          .where(
            and(
              eq(observabilityEvents.eventType, developmentLoopNoopEventType),
              sql`${observabilityEvents.payload}->>'deliveryId' = ${input.trigger.deliveryId}`,
            ),
          )
          .limit(1)
      : [];

    if (existingNoop[0]) {
      return;
    }

    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.fullName, input.trigger.repositoryFullName))
      .limit(1);

    await tx.insert(observabilityEvents).values({
      ...(repository ? { repositoryId: repository.id } : {}),
      correlationId: input.trigger.deliveryId,
      createdAt,
      eventType: developmentLoopNoopEventType,
      message: "Agent-ready development loop trigger recorded as a no-op.",
      payload: {
        deliveryId: input.trigger.deliveryId,
        issueNumber: input.trigger.issueNumber,
        loopKey: developmentLoopKey,
        reason: input.reason,
        repositoryFullName: input.trigger.repositoryFullName,
      },
      severity: "info",
    });
  });

  return {
    mode: "noop",
    reason: input.reason,
  };
}
