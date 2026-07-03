import { NextResponse } from "next/server";

import { db } from "@/db/client";
import {
  canUseInMemoryGithubWebhookDeliveryStore,
  claimGithubWebhookDelivery,
  createInMemoryGithubWebhookDeliveryStore,
  getLoopAwareAgentReadyTriggerFromIssuesWebhook,
  type GithubAgentReadyLoopResolver,
  type GithubAgentReadyTrigger,
  type GithubWebhookDeliveryStore,
  type GithubIssuesWebhookPayload,
  verifyGithubWebhookSignature,
} from "@/lib/github/webhooks";
import { createDrizzleGithubWebhookDeliveryStore } from "@/lib/github/webhook-store";
import {
  createDevelopmentLoopRun,
  recordDevelopmentLoopNoop,
  simulateDevelopmentLoopRun,
  type DevelopmentLoopNoopMetadata,
  type DevelopmentLoopRunDatabase,
  type DevelopmentLoopRunMetadata,
  type DevelopmentLoopTrigger,
} from "@/lib/loops/development-run";
import { createRequestLogger } from "@/lib/observability/logger";
import { getActiveTraceId } from "@/lib/observability/trace-context";

const inMemoryWebhookDeliveryStore = createInMemoryGithubWebhookDeliveryStore();

export const runtime = "nodejs";

type GithubWebhookPostDependencies = {
  developmentRunDatabase?: DevelopmentLoopRunDatabase;
  getAgentReadyTrigger?: (
    payload: GithubIssuesWebhookPayload,
    resolveLoop: GithubAgentReadyLoopResolver,
  ) => GithubAgentReadyTrigger;
  now?: () => Date;
  webhookDeliveryStore?: GithubWebhookDeliveryStore;
};

type GithubWebhookDeliveryStoreMode = "drizzle" | "injected" | "memory";
type DevelopmentRunOutcome = DevelopmentLoopRunMetadata | DevelopmentLoopNoopMetadata;

function asIssuesPayload(payload: unknown): GithubIssuesWebhookPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  return payload as GithubIssuesWebhookPayload;
}

function getGithubWebhookDeliveryStore(): {
  mode: Exclude<GithubWebhookDeliveryStoreMode, "injected">;
  store: GithubWebhookDeliveryStore;
} {
  if (canUseInMemoryGithubWebhookDeliveryStore()) {
    return {
      mode: "memory",
      store: inMemoryWebhookDeliveryStore,
    };
  }

  return {
    mode: "drizzle",
    store: createDrizzleGithubWebhookDeliveryStore(),
  };
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  );
}

function summarizeGithubWebhookPayload(
  event: string,
  payload: GithubIssuesWebhookPayload | null,
): Record<string, unknown> {
  if (event !== "issues" || !payload?.issue) {
    return {
      event,
    };
  }

  return compactRecord({
    action: payload.action,
    event,
    issueNumber: payload.issue.number,
    issueUrl: payload.issue.html_url,
    labels: (payload.issue.labels ?? [])
      .map((label) => label.name?.trim())
      .filter((label): label is string => Boolean(label)),
    milestoneTitle: payload.issue.milestone?.title,
    repositoryFullName: payload.repository?.full_name,
  });
}

const loopEnabledEnvKeys = {
  development: "LOOPWORKS_DEVELOPMENT_LOOP_ENABLED",
  research: "LOOPWORKS_RESEARCH_LOOP_ENABLED",
} as const;

function readLoopEnabledFlag(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

const resolveAgentReadyLoopState: GithubAgentReadyLoopResolver = (trigger) => ({
  enabled: readLoopEnabledFlag(
    process.env[loopEnabledEnvKeys[trigger.workflow]] ??
      process.env.LOOPWORKS_AGENT_READY_LOOP_ENABLED,
  ),
});

function getNextAction(agentReadyTrigger: GithubAgentReadyTrigger): string {
  if (agentReadyTrigger.shouldTrigger === true && agentReadyTrigger.workflow === "research") {
    return "queue_deep_research_loop";
  }

  if (agentReadyTrigger.shouldTrigger === true) {
    return "queue_planning_agent";
  }

  return "record_and_ignore";
}

function getFailureType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function getFixtureFallbackResponse(mode: GithubWebhookDeliveryStoreMode) {
  return mode === "memory"
    ? {
        fixture: {
          webhookDeliveryStore: "memory",
        },
      }
    : {};
}

function getIssueLabels(payload: GithubIssuesWebhookPayload): string[] {
  return (payload.issue?.labels ?? [])
    .map((label) => label.name?.trim())
    .filter((label): label is string => Boolean(label));
}

function getDevelopmentLoopTrigger(
  payload: GithubIssuesWebhookPayload | null,
  deliveryId: string,
): DevelopmentLoopTrigger | null {
  if (!payload?.issue?.number || !payload.repository?.full_name) {
    return null;
  }

  return {
    body: payload.issue.body ?? "",
    deliveryId,
    issueNumber: payload.issue.number,
    issueUrl: payload.issue.html_url ?? undefined,
    labels: getIssueLabels(payload),
    milestone: payload.issue.milestone?.title ?? null,
    repositoryFullName: payload.repository.full_name,
    title: payload.issue.title ?? "",
  };
}

async function resolveDevelopmentRunOutcome(input: {
  agentReadyTrigger: GithubAgentReadyTrigger;
  database: DevelopmentLoopRunDatabase;
  issuesPayload: GithubIssuesWebhookPayload | null;
  normalizedDeliveryId: string;
  now: Date;
  persist: boolean;
  traceId?: string;
}): Promise<DevelopmentRunOutcome | undefined> {
  const trigger = getDevelopmentLoopTrigger(input.issuesPayload, input.normalizedDeliveryId);

  if (
    input.agentReadyTrigger.shouldTrigger &&
    input.agentReadyTrigger.workflow === "development" &&
    trigger
  ) {
    if (input.persist) {
      return createDevelopmentLoopRun({
        database: input.database,
        now: () => input.now,
        traceId: input.traceId,
        trigger,
      });
    }

    return simulateDevelopmentLoopRun({
      now: input.now,
      trigger,
    });
  }

  if (
    !input.agentReadyTrigger.shouldTrigger &&
    input.agentReadyTrigger.skipped &&
    input.agentReadyTrigger.reason === "loop_disabled" &&
    input.agentReadyTrigger.workflow === "development" &&
    trigger
  ) {
    if (input.persist) {
      return recordDevelopmentLoopNoop({
        database: input.database,
        now: () => input.now,
        reason: "loop_disabled",
        trigger,
      });
    }

    return {
      mode: "noop",
      reason: "loop_disabled",
    };
  }

  return undefined;
}

export async function handleGithubWebhookPost(
  request: Request,
  dependencies: GithubWebhookPostDependencies = {},
) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event") ?? "unknown";
  const getAgentReadyTrigger =
    dependencies.getAgentReadyTrigger ?? getLoopAwareAgentReadyTriggerFromIssuesWebhook;
  const developmentRunDatabase = dependencies.developmentRunDatabase ?? db;
  const now = dependencies.now ?? (() => new Date());
  const traceId = getActiveTraceId();
  const requestLogger = createRequestLogger({
    route: "api.github.webhooks",
    githubDeliveryId: deliveryId,
    githubEvent: event,
  });

  if (!webhookSecret) {
    requestLogger.error("github_webhook_secret_missing");
    return NextResponse.json(
      {
        error: "Missing GITHUB_WEBHOOK_SECRET.",
      },
      { status: 500 },
    );
  }

  const signature = request.headers.get("x-hub-signature-256");
  const payloadText = await request.text();

  if (!deliveryId) {
    requestLogger.warn("github_webhook_delivery_id_missing");
    return NextResponse.json(
      {
        error: "Missing x-github-delivery header.",
      },
      { status: 400 },
    );
  }

  if (
    !verifyGithubWebhookSignature({
      secret: webhookSecret,
      payload: payloadText,
      signature,
    })
  ) {
    requestLogger.warn("github_webhook_signature_invalid");
    return NextResponse.json(
      {
        error: "Invalid GitHub webhook signature.",
      },
      { status: 401 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadText) as unknown;
  } catch {
    requestLogger.warn("github_webhook_payload_invalid_json");
    return NextResponse.json(
      {
        error: "Webhook payload must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const issuesPayload = asIssuesPayload(payload);
  const repositoryFullName = issuesPayload?.repository?.full_name ?? null;
  const action = issuesPayload?.action ?? null;
  const selectedDeliveryStore = dependencies.webhookDeliveryStore
    ? {
        mode: "injected" as const,
        store: dependencies.webhookDeliveryStore,
      }
    : getGithubWebhookDeliveryStore();
  const webhookDeliveryStore = selectedDeliveryStore.store;
  const webhookLogger = requestLogger.child({
    githubAction: action,
    repositoryFullName,
    webhookDeliveryStore: selectedDeliveryStore.mode,
  });

  let claim: Awaited<ReturnType<typeof claimGithubWebhookDelivery>>;
  try {
    claim = await claimGithubWebhookDelivery({
      store: webhookDeliveryStore,
      deliveryId,
      event,
      action,
      repositoryFullName,
      payload: summarizeGithubWebhookPayload(event, issuesPayload),
    });
  } catch (error) {
    webhookLogger.error(
      {
        err: error,
        failureType: getFailureType(error),
      },
      "github_webhook_claim_failed",
    );
    throw error;
  }

  if (!claim.accepted) {
    webhookLogger.info(
      {
        idempotencyKey: claim.key,
      },
      "github_webhook_duplicate_ignored",
    );
    return NextResponse.json(
      {
        accepted: false,
        duplicate: true,
        deliveryId: claim.deliveryId,
        idempotencyKey: claim.key,
        ...getFixtureFallbackResponse(selectedDeliveryStore.mode),
      },
      { status: 202 },
    );
  }

  try {
    const agentReadyTrigger: GithubAgentReadyTrigger =
      event === "issues" && issuesPayload
        ? getAgentReadyTrigger(issuesPayload, resolveAgentReadyLoopState)
        : { shouldTrigger: false, reason: "unsupported_event" };
    const nextAction = getNextAction(agentReadyTrigger);
    const deliveryStatus = agentReadyTrigger.shouldTrigger ? "processed" : "ignored";
    const processedAt = now();
    const developmentRun = await resolveDevelopmentRunOutcome({
      agentReadyTrigger,
      database: developmentRunDatabase,
      issuesPayload,
      normalizedDeliveryId: claim.deliveryId,
      now: processedAt,
      persist:
        selectedDeliveryStore.mode === "drizzle" || Boolean(dependencies.developmentRunDatabase),
      traceId,
    });

    await webhookDeliveryStore.complete(claim.key, {
      deliveryId: claim.deliveryId,
      metadata: {
        ...(developmentRun ? { developmentRun } : {}),
        nextAction,
        triggerReason: agentReadyTrigger.reason,
        triggerWorkflow: agentReadyTrigger.workflow ?? "none",
      },
      processedAt: processedAt.toISOString(),
      status: deliveryStatus,
    });

    webhookLogger.info(
      {
        idempotencyKey: claim.key,
        agentReadyTrigger,
        developmentRun,
        nextAction,
        triggerWorkflow: agentReadyTrigger.workflow ?? "none",
      },
      "github_webhook_processed",
    );

    return NextResponse.json(
      {
        accepted: true,
        duplicate: false,
        deliveryId: claim.deliveryId,
        idempotencyKey: claim.key,
        event,
        agentReadyTrigger,
        ...(developmentRun ? { developmentRun } : {}),
        nextAction,
        ...getFixtureFallbackResponse(selectedDeliveryStore.mode),
      },
      { status: 202 },
    );
  } catch (error) {
    const failureType = getFailureType(error);
    webhookLogger.error(
      {
        err: error,
        failureType,
        idempotencyKey: claim.key,
      },
      "github_webhook_processing_failed",
    );

    try {
      await webhookDeliveryStore.complete(claim.key, {
        deliveryId: claim.deliveryId,
        metadata: {
          failureType,
          nextAction: "record_and_ignore",
          triggerWorkflow: "none",
        },
        processedAt: now().toISOString(),
        status: "failed",
      });
    } catch (completionError) {
      webhookLogger.error(
        {
          err: completionError,
          completionFailureType: getFailureType(completionError),
          failureType,
          idempotencyKey: claim.key,
        },
        "github_webhook_failed_outcome_recording_failed",
      );
    }

    throw error;
  }
}

export async function POST(request: Request) {
  return handleGithubWebhookPost(request);
}
