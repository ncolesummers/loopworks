import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  agentPlans,
  artifacts,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import { createPlanningAgentSeedPlan } from "@agent/planning-agent";
import { recordDevelopmentLoopRunCreatedObservability } from "@/lib/observability/metrics";
import { getActiveTraceId, isValidW3cTraceId } from "@/lib/observability/trace-context";
import type { ArtifactRecord, TimelineEvent, TimelineKind } from "@/lib/types";

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
  | "patch"
  | "pr_intent"
  | "log_summary"
  | "other";

type DevelopmentLoopArtifactContract = {
  label: string;
  required: true;
  type: DevelopmentLoopArtifactType;
};

type DevelopmentLoopStageContract = {
  actorId: string;
  actorType: "agent" | "ci" | "human" | "system";
  artifact: DevelopmentLoopArtifactContract;
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
    artifact: { label: "Plan artifact", required: true, type: "plan" },
    key: "planning",
    summary:
      "Create an issue-backed execution plan with acceptance criteria and validation mapping.",
    timelineKind: "planning",
    title: "Planning",
  },
  {
    actorId: "eve-builder-agent",
    actorType: "agent",
    artifact: { label: "Red test evidence", required: true, type: "validation_report" },
    key: "test-writing",
    summary: "Write focused failing tests before production code changes.",
    timelineKind: "test",
    title: "Test writing",
    validationCommand: "bun run test",
    validationStatus: "red",
  },
  {
    actorId: "eve-builder-agent",
    actorType: "agent",
    artifact: { label: "Patch artifact", required: true, type: "patch" },
    key: "development",
    summary: "Implement the smallest green change for the issue scope.",
    timelineKind: "development",
    title: "Development",
  },
  {
    actorId: "ci-runner",
    actorType: "ci",
    artifact: { label: "Validation report", required: true, type: "validation_report" },
    key: "validation",
    summary: "Run deterministic checks before review, LLM judgment, commit, or PR stages.",
    timelineKind: "validation",
    title: "Validation",
    validationCommand: "bun run validate",
    validationStatus: "required",
  },
  {
    actorId: "reviewer",
    actorType: "human",
    artifact: { label: "Code review notes", required: true, type: "log_summary" },
    key: "code-review",
    summary: "Review assumptions, security/a11y risks, and validation evidence.",
    timelineKind: "review",
    title: "Code review",
  },
  {
    actorId: "maintainer",
    actorType: "human",
    artifact: { label: "Commit intent", required: true, type: "other" },
    key: "commit",
    summary: "Prepare an atomic conventional commit only after validation and review.",
    timelineKind: "commit",
    title: "Commit",
  },
  {
    actorId: "maintainer",
    actorType: "human",
    artifact: { label: "PR intent", required: true, type: "pr_intent" },
    key: "pr",
    summary: "Prepare PR metadata linking the source issue, run, and validation evidence.",
    timelineKind: "pull_request",
    title: "PR",
  },
  {
    actorId: "loopworks",
    actorType: "system",
    artifact: { label: "Completion summary", required: true, type: "other" },
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
  title?: string | null;
};

export type DevelopmentLoopRunDatabase = Pick<typeof db, "transaction">;

export type DevelopmentLoopRunMetadata =
  | {
      artifactCount: number;
      mode: "created";
      runId: string;
      stageCount: number;
    }
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
  metadata: DevelopmentLoopRunMetadata;
};

type DevelopmentLoopStageInstance = {
  actorId: string;
  actorType: string;
  artifact: DevelopmentLoopArtifactInstance;
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

function getArtifactUri(trigger: DevelopmentLoopTrigger, stage: DevelopmentLoopStageContract) {
  return `${getIssueUrl(trigger)}#development-loop-${stage.key}`;
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
    const artifact = {
      detail: stage.summary,
      label: stage.artifact.label,
      required: stage.artifact.required,
      type: stage.artifact.type,
      uri: getArtifactUri(input.trigger, stage),
    };

    return {
      actorId: stage.actorId,
      actorType: stage.actorType,
      artifact,
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
    artifacts: stages.map((stage) => stage.artifact),
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
    artifact: stage.artifact.label,
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

export async function createDevelopmentLoopRun(input: {
  database: DevelopmentLoopRunDatabase;
  now?: () => Date;
  traceId?: string;
  trigger: DevelopmentLoopTrigger;
}): Promise<DevelopmentLoopRunMetadata> {
  const createdAt = input.now?.() ?? new Date();
  const traceId =
    input.traceId === undefined
      ? getActiveTraceId()
      : isValidW3cTraceId(input.traceId)
        ? input.traceId
        : undefined;

  const result: DevelopmentLoopRunTransactionResult = await input.database.transaction(
    async (tx) => {
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
            mode: "created",
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

      const runId = randomUUID();
      const skeleton = createDevelopmentLoopRunSkeleton({
        mode: "created",
        now: createdAt,
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
          deliveryId: input.trigger.deliveryId,
          labels: input.trigger.labels ?? [],
          milestone: input.trigger.milestone ?? null,
          source: "github_issue",
          stageCount: skeleton.stages.length,
        },
        queuedAt: createdAt,
        repositoryId: repository.id,
        status: "queued",
        traceId,
      });

      const stepIds: string[] = [];
      for (const stage of skeleton.stages) {
        const stepId = randomUUID();
        stepIds.push(stepId);
        await tx.insert(runSteps).values({
          id: stepId,
          actorId: stage.actorId,
          actorType: stage.actorType,
          metadata: {
            artifactLabel: stage.artifact.label,
            requiredArtifact: stage.artifact.required,
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
        skeleton.artifacts.map((artifact, index) => ({
          id: randomUUID(),
          metadata: {
            required: artifact.required,
            stage: skeleton.stages[index]?.key,
          },
          runId,
          stepId: stepIds[index],
          title: artifact.label,
          type: artifact.type,
          uri: artifact.uri,
        })),
      );

      await tx.insert(agentPlans).values({
        agentName: "planning-agent",
        input: {
          issueNumber: input.trigger.issueNumber,
          labels: input.trigger.labels ?? [],
          milestone: input.trigger.milestone ?? null,
          repositoryFullName: input.trigger.repositoryFullName,
          title: input.trigger.title ?? "",
        },
        issueNumber: input.trigger.issueNumber,
        plan: createPlanningAgentSeedPlan({
          body: input.trigger.body ?? "",
          issueNumber: input.trigger.issueNumber,
          issueUrl: getIssueUrl(input.trigger),
          labels: [...(input.trigger.labels ?? [])],
          milestone: input.trigger.milestone ?? null,
          repositoryFullName: input.trigger.repositoryFullName,
          title: input.trigger.title ?? `Issue #${input.trigger.issueNumber}`,
        }),
        runId,
        status: "pending",
      });

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

      return {
        emitObservability,
        metadata: {
          artifactCount: skeleton.artifacts.length,
          mode: "created",
          runId,
          stageCount: skeleton.stages.length,
        },
      };
    },
  );

  result.emitObservability?.();

  return result.metadata;
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
