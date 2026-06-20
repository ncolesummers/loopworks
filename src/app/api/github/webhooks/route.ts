import { NextResponse } from "next/server";

import {
  canUseInMemoryGithubWebhookDeliveryStore,
  claimGithubWebhookDelivery,
  createInMemoryGithubWebhookDeliveryStore,
  getAgentReadyTriggerFromIssuesWebhook,
  type GithubAgentReadyTrigger,
  type GithubIssuesWebhookPayload,
  verifyGithubWebhookSignature,
} from "@/lib/github/webhooks";
import { createRequestLogger } from "@/lib/observability/logger";

const webhookDeliveryStore = createInMemoryGithubWebhookDeliveryStore();

export const runtime = "nodejs";

function asIssuesPayload(payload: unknown): GithubIssuesWebhookPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  return payload as GithubIssuesWebhookPayload;
}

export async function POST(request: Request) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const deliveryId = request.headers.get("x-github-delivery");
  const event = request.headers.get("x-github-event") ?? "unknown";
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

  if (!canUseInMemoryGithubWebhookDeliveryStore()) {
    requestLogger.error("github_webhook_durable_store_missing");
    return NextResponse.json(
      {
        error: "Durable GitHub webhook delivery store is required in production.",
      },
      { status: 503 },
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

  const agentReadyTrigger: GithubAgentReadyTrigger =
    event === "issues" && issuesPayload
      ? getAgentReadyTriggerFromIssuesWebhook(issuesPayload)
      : { shouldTrigger: false, reason: "unsupported_event" };

  webhookLogger.info(
    {
      idempotencyKey: claim.key,
      agentReadyTrigger,
      nextAction:
        agentReadyTrigger.shouldTrigger === true && agentReadyTrigger.workflow === "research"
          ? "queue_deep_research_loop"
          : agentReadyTrigger.shouldTrigger === true
            ? "queue_eve_planning_agent"
            : "record_and_ignore",
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
      nextAction:
        agentReadyTrigger.shouldTrigger === true && agentReadyTrigger.workflow === "research"
          ? "queue_deep_research_loop"
          : agentReadyTrigger.shouldTrigger === true
            ? "queue_eve_planning_agent"
            : "record_and_ignore",
    },
    { status: 202 },
  );
}
