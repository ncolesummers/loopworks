import { NextResponse } from "next/server";

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
import { createRequestLogger } from "@/lib/observability/logger";

const inMemoryWebhookDeliveryStore = createInMemoryGithubWebhookDeliveryStore();

export const runtime = "nodejs";

type GithubWebhookPostDependencies = {
  getAgentReadyTrigger?: (
    payload: GithubIssuesWebhookPayload,
    resolveLoop: GithubAgentReadyLoopResolver,
  ) => GithubAgentReadyTrigger;
  now?: () => Date;
  webhookDeliveryStore?: GithubWebhookDeliveryStore;
};

function asIssuesPayload(payload: unknown): GithubIssuesWebhookPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  return payload as GithubIssuesWebhookPayload;
}

function getGithubWebhookDeliveryStore() {
  if (canUseInMemoryGithubWebhookDeliveryStore()) {
    return inMemoryWebhookDeliveryStore;
  }

  return createDrizzleGithubWebhookDeliveryStore();
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
    return "queue_eve_planning_agent";
  }

  return "record_and_ignore";
}

function getFailureType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
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
  const now = dependencies.now ?? (() => new Date());
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
  const webhookDeliveryStore = dependencies.webhookDeliveryStore ?? getGithubWebhookDeliveryStore();
  const webhookLogger = requestLogger.child({
    githubAction: action,
    repositoryFullName,
  });

  const claim = await claimGithubWebhookDelivery({
    store: webhookDeliveryStore,
    deliveryId,
    event,
    action,
    repositoryFullName,
    payload: summarizeGithubWebhookPayload(event, issuesPayload),
  });

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

    await webhookDeliveryStore.complete?.(claim.key, {
      deliveryId: claim.deliveryId,
      metadata: {
        nextAction,
        triggerReason: agentReadyTrigger.reason,
        triggerWorkflow: agentReadyTrigger.shouldTrigger ? agentReadyTrigger.workflow : "none",
      },
      processedAt: now().toISOString(),
      status: deliveryStatus,
    });

    webhookLogger.info(
      {
        idempotencyKey: claim.key,
        agentReadyTrigger,
        nextAction,
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
        nextAction,
      },
      { status: 202 },
    );
  } catch (error) {
    const failureType = getFailureType(error);
    webhookLogger.error(
      {
        failureType,
        idempotencyKey: claim.key,
      },
      "github_webhook_processing_failed",
    );

    try {
      await webhookDeliveryStore.complete?.(claim.key, {
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
