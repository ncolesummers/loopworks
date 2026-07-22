import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  artifacts,
  idempotencyLocks,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import { recordResearchLoopRunCreatedObservability } from "@/lib/observability/metrics";
import { getActiveTraceId, isValidW3cTraceId } from "@/lib/observability/trace-context";
import type { ArtifactRecord, TimelineEvent, TimelineKind } from "@/lib/types";

export const researchLoopKey = "research-loop";
export const researchLoopNoopEventType = "research_loop_noop";

export type ResearchLoopStageKey = "planning" | "researching" | "authoring" | "done";
export type ResearchArtifactKind =
  | "research_plan"
  | "findings"
  | "research_document"
  | "completion_summary";
export type ResearchArtifactCardinality = "one" | "one_per_subquestion";
export type ResearchArtifactIsolation = "run" | "child_session";
export type ResearchArtifactPersistedType = "plan" | "other";

type ResearchArtifactContract = {
  cardinality: ResearchArtifactCardinality;
  isolation: ResearchArtifactIsolation;
  kind: ResearchArtifactKind;
  label: string;
  required: true;
  type: ResearchArtifactPersistedType;
};

type ResearchLoopStageContract = {
  actorId: "research-planner" | "researcher" | "research-author" | "loopworks";
  actorType: "agent" | "system";
  artifact: ResearchArtifactContract;
  key: ResearchLoopStageKey;
  summary: string;
  timelineKind: TimelineKind;
  title: string;
};

export const researchLoopStages = [
  {
    actorId: "research-planner",
    actorType: "agent",
    artifact: {
      cardinality: "one",
      isolation: "run",
      kind: "research_plan",
      label: "Research plan",
      required: true,
      type: "plan",
    },
    key: "planning",
    summary: "Define the research question, subquestions, sources, and completion criteria.",
    timelineKind: "planning",
    title: "Planning",
  },
  {
    actorId: "researcher",
    actorType: "agent",
    artifact: {
      cardinality: "one_per_subquestion",
      isolation: "child_session",
      kind: "findings",
      label: "Findings artifacts",
      required: true,
      type: "other",
    },
    key: "researching",
    summary:
      "Index findings expected from isolated child sessions; live fan-out remains deferred to issue #45.",
    timelineKind: "research",
    title: "Researching",
  },
  {
    actorId: "research-author",
    actorType: "agent",
    artifact: {
      cardinality: "one",
      isolation: "run",
      kind: "research_document",
      label: "Research document",
      required: true,
      type: "other",
    },
    key: "authoring",
    summary: "Synthesize the indexed findings into a reviewable research document.",
    timelineKind: "authoring",
    title: "Authoring",
  },
  {
    actorId: "loopworks",
    actorType: "system",
    artifact: {
      cardinality: "one",
      isolation: "run",
      kind: "completion_summary",
      label: "Completion summary",
      required: true,
      type: "other",
    },
    key: "done",
    summary: "Record completion after the research document contract is satisfied.",
    timelineKind: "done",
    title: "Done",
  },
] as const satisfies readonly ResearchLoopStageContract[];

const nextResearchLoopStage = {
  planning: "researching",
  researching: "authoring",
  authoring: "done",
  done: null,
} as const satisfies Record<ResearchLoopStageKey, ResearchLoopStageKey | null>;

export function getNextResearchLoopStage(stage: ResearchLoopStageKey): ResearchLoopStageKey | null {
  return nextResearchLoopStage[stage];
}

export type ResearchLoopTrigger = {
  body?: string;
  deliveryId?: string;
  issueNumber: number;
  issueUrl?: string;
  labels?: readonly string[];
  milestone?: string | null;
  repositoryFullName: string;
  title?: string | null;
};

export type ResearchLoopRunDatabase = Pick<typeof db, "transaction">;

export type ResearchLoopRunMetadata =
  | { artifactCount: number; mode: "created"; runId: string; stageCount: number }
  | { artifactCount: number; mode: "simulated"; stageCount: number };

export type ResearchLoopNoopMetadata = { mode: "noop"; reason: "loop_disabled" };

type ResearchArtifactInstance = ResearchArtifactContract & {
  detail: string;
  stageKey: ResearchLoopStageKey;
  uri: string;
};

type ResearchStageInstance = Omit<ResearchLoopStageContract, "artifact"> & {
  artifact: ResearchArtifactInstance;
  queuedAt: Date;
  status: "queued";
};

export type ResearchLoopRunSkeleton = {
  artifacts: ResearchArtifactInstance[];
  loopKey: typeof researchLoopKey;
  mode: "created" | "simulated";
  runId?: string;
  stages: ResearchStageInstance[];
  trigger: ResearchLoopTrigger;
};

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function getIssueUrl(trigger: ResearchLoopTrigger): string {
  return (
    trigger.issueUrl?.trim() ||
    `https://github.com/${trigger.repositoryFullName}/issues/${trigger.issueNumber}`
  );
}

function getArtifactKind(type: ResearchArtifactPersistedType): ArtifactRecord["kind"] {
  return type === "plan" ? "review" : "log";
}

export function createResearchLoopRunSkeleton(input: {
  mode: "created" | "simulated";
  now: Date;
  runId?: string;
  trigger: ResearchLoopTrigger;
}): ResearchLoopRunSkeleton {
  const stages = researchLoopStages.map((definition, index) => {
    const stage: ResearchLoopStageContract = definition;
    const artifact: ResearchArtifactInstance = {
      ...stage.artifact,
      detail: stage.summary,
      stageKey: stage.key,
      uri: `${getIssueUrl(input.trigger)}#research-loop-${stage.key}-${stage.artifact.kind.replaceAll("_", "-")}`,
    };

    return {
      ...stage,
      artifact,
      queuedAt: minutesAfter(input.now, index),
      status: "queued" as const,
    };
  });

  return {
    artifacts: stages.map((stage) => stage.artifact),
    loopKey: researchLoopKey,
    mode: input.mode,
    ...(input.runId ? { runId: input.runId } : {}),
    stages,
    trigger: input.trigger,
  };
}

export function projectResearchLoopTimeline(skeleton: ResearchLoopRunSkeleton): TimelineEvent[] {
  return skeleton.stages.map((stage) => ({
    actor: stage.actorId,
    artifact: stage.artifact.label,
    at: stage.queuedAt.toISOString().slice(11, 16),
    detail: stage.summary,
    kind: stage.timelineKind,
    title: stage.title,
  }));
}

export function projectResearchLoopArtifacts(skeleton: ResearchLoopRunSkeleton): ArtifactRecord[] {
  return skeleton.artifacts.map((artifact) => ({
    detail: artifact.detail,
    href: artifact.uri,
    kind: getArtifactKind(artifact.type),
    label: artifact.label,
    state: "available",
  }));
}

export function simulateResearchLoopRun(input: {
  now: Date;
  trigger: ResearchLoopTrigger;
}): ResearchLoopRunMetadata {
  const skeleton = createResearchLoopRunSkeleton({
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

export async function createResearchLoopRun(input: {
  database: ResearchLoopRunDatabase;
  now?: () => Date;
  traceId?: string;
  trigger: ResearchLoopTrigger;
}): Promise<ResearchLoopRunMetadata> {
  const createdAt = input.now?.() ?? new Date();
  const traceId =
    input.traceId === undefined
      ? getActiveTraceId()
      : isValidW3cTraceId(input.traceId)
        ? input.traceId
        : undefined;

  const result = await input.database.transaction(async (tx) => {
    if (input.trigger.deliveryId) {
      await tx
        .insert(idempotencyLocks)
        .values({
          acquiredAt: createdAt,
          expiresAt: createdAt,
          key: `${researchLoopKey}:run:${input.trigger.deliveryId}`,
          metadata: { deliveryId: input.trigger.deliveryId, operation: "run" },
          owner: researchLoopKey,
          releasedAt: createdAt,
          scope: researchLoopKey,
          status: "released",
        })
        .onConflictDoNothing({ target: idempotencyLocks.key });
    }

    const existingRun = input.trigger.deliveryId
      ? await tx
          .select({ id: loopRuns.id })
          .from(loopRuns)
          .where(
            and(
              eq(loopRuns.loopKey, researchLoopKey),
              sql`${loopRuns.metadata}->>'deliveryId' = ${input.trigger.deliveryId}`,
            ),
          )
          .limit(1)
      : [];

    if (existingRun[0]) {
      const [existingArtifacts, existingSteps] = await Promise.all([
        tx
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(eq(artifacts.runId, existingRun[0].id)),
        tx.select({ id: runSteps.id }).from(runSteps).where(eq(runSteps.runId, existingRun[0].id)),
      ]);
      return {
        metadata: {
          artifactCount: existingArtifacts.length,
          mode: "created" as const,
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
        `Cannot create research loop run for unknown repository: ${input.trigger.repositoryFullName}`,
      );
    }

    const runId = randomUUID();
    const skeleton = createResearchLoopRunSkeleton({
      mode: "created",
      now: createdAt,
      runId,
      trigger: input.trigger,
    });
    await tx.insert(loopRuns).values({
      id: runId,
      currentStage: researchLoopStages[0].key,
      githubIssueNumber: input.trigger.issueNumber,
      githubIssueUrl: getIssueUrl(input.trigger),
      loopKey: researchLoopKey,
      metadata: {
        deliveryId: input.trigger.deliveryId,
        issueTitle: input.trigger.title ?? `Issue #${input.trigger.issueNumber}`,
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

    const stepIds = new Map<ResearchLoopStageKey, string>();
    for (const stage of skeleton.stages) {
      const stepId = randomUUID();
      stepIds.set(stage.key, stepId);
      await tx.insert(runSteps).values({
        actorId: stage.actorId,
        actorType: stage.actorType,
        id: stepId,
        metadata: {
          artifactKind: stage.artifact.kind,
          requiredArtifact: stage.artifact.required,
        },
        queuedAt: stage.queuedAt,
        runId,
        stage: stage.key,
        status: stage.status,
        summary: stage.summary,
        traceId,
      });
    }

    await tx.insert(artifacts).values(
      skeleton.artifacts.map((artifact) => ({
        id: randomUUID(),
        metadata: {
          cardinality: artifact.cardinality,
          isolation: artifact.isolation,
          required: artifact.required,
          researchArtifactKind: artifact.kind,
          stage: artifact.stageKey,
        },
        runId,
        stepId: stepIds.get(artifact.stageKey),
        title: artifact.label,
        type: artifact.type,
        uri: artifact.uri,
      })),
    );

    const emitObservability = await recordResearchLoopRunCreatedObservability({
      artifactCount: skeleton.artifacts.length,
      deliveryId: input.trigger.deliveryId,
      issueNumber: input.trigger.issueNumber,
      loopKey: researchLoopKey,
      repositoryFullName: input.trigger.repositoryFullName,
      repositoryId: repository.id,
      runId,
      stageCount: skeleton.stages.length,
      traceId,
      triggerLabel: "spike",
      writer: tx,
    });

    return {
      emitObservability,
      metadata: {
        artifactCount: skeleton.artifacts.length,
        mode: "created" as const,
        runId,
        stageCount: skeleton.stages.length,
      },
    };
  });

  result.emitObservability?.();
  return result.metadata;
}

export async function recordResearchLoopNoop(input: {
  database: ResearchLoopRunDatabase;
  now?: () => Date;
  reason: "loop_disabled";
  trigger: ResearchLoopTrigger;
}): Promise<ResearchLoopNoopMetadata> {
  const createdAt = input.now?.() ?? new Date();
  await input.database.transaction(async (tx) => {
    if (input.trigger.deliveryId) {
      await tx
        .insert(idempotencyLocks)
        .values({
          acquiredAt: createdAt,
          expiresAt: createdAt,
          key: `${researchLoopKey}:noop:${input.trigger.deliveryId}`,
          metadata: { deliveryId: input.trigger.deliveryId, operation: "noop" },
          owner: researchLoopKey,
          releasedAt: createdAt,
          scope: researchLoopKey,
          status: "released",
        })
        .onConflictDoNothing({ target: idempotencyLocks.key });
    }

    const existing = input.trigger.deliveryId
      ? await tx
          .select({ id: observabilityEvents.id })
          .from(observabilityEvents)
          .where(
            and(
              eq(observabilityEvents.eventType, researchLoopNoopEventType),
              sql`${observabilityEvents.payload}->>'deliveryId' = ${input.trigger.deliveryId}`,
            ),
          )
          .limit(1)
      : [];
    if (existing[0]) return;

    const [repository] = await tx
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.fullName, input.trigger.repositoryFullName))
      .limit(1);
    await tx.insert(observabilityEvents).values({
      ...(repository ? { repositoryId: repository.id } : {}),
      correlationId: input.trigger.deliveryId,
      createdAt,
      eventType: researchLoopNoopEventType,
      message: "Spike research loop trigger recorded as a no-op.",
      payload: {
        deliveryId: input.trigger.deliveryId,
        issueNumber: input.trigger.issueNumber,
        loopKey: researchLoopKey,
        reason: input.reason,
        repositoryFullName: input.trigger.repositoryFullName,
      },
      severity: "info",
    });
  });

  return { mode: "noop", reason: input.reason };
}
