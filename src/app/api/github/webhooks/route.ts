import { NextResponse } from "next/server";

import { db } from "@/db/client";
import { readStringConfig, readSuppliedBooleanConfig } from "@/lib/config/registry";
import {
  createGithubIssueActivationPermissionResolver,
  evaluateGithubIssueActivationTransition,
  type GithubIssueActivationPermissionDecision,
  type NormalizedGithubIssueActivation,
  normalizeGithubIssueActivationPayload,
} from "@/lib/github/issue-activation-authorization";
import {
  createGithubIssueActivationRepositoryBindingResolver,
  type GithubIssueActivationRepositoryBindingDecision,
  type GithubIssueActivationRepositoryBindingResolver,
} from "@/lib/github/issue-activation-store";
import { createDrizzleGithubWebhookDeliveryStore } from "@/lib/github/webhook-store";
import {
  canUseInMemoryGithubWebhookDeliveryStore,
  claimGithubWebhookDelivery,
  createInMemoryGithubWebhookDeliveryStore,
  type GithubAgentReadyLoopResolver,
  type GithubAgentReadyTrigger,
  type GithubIssuesWebhookPayload,
  type GithubWebhookDeliveryStore,
  getLoopAwareAgentReadyTriggerFromIssuesWebhook,
  normalizeGithubDeliveryId,
  verifyGithubWebhookSignature,
} from "@/lib/github/webhooks";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopNoopMetadata,
  type DevelopmentLoopRunDatabase,
  type DevelopmentLoopRunMetadata,
  type DevelopmentLoopTrigger,
  recordDevelopmentLoopNoop,
  simulateDevelopmentLoopRun,
} from "@/lib/loops/development-run";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import {
  createResearchLoopRun,
  type ResearchLoopNoopMetadata,
  type ResearchLoopRunMetadata,
  type ResearchLoopTrigger,
  recordResearchLoopNoop,
  simulateResearchLoopRun,
} from "@/lib/loops/research-run";
import { createRequestLogger } from "@/lib/observability/logger";
import {
  type GithubWebhookOutcome,
  type GithubWebhookOutcomeMetricInput,
  recordGithubWebhookOutcomeMetric,
} from "@/lib/observability/metrics";
import {
  getActiveTraceId,
  markGithubWebhookActivationSpanOutcome,
  withLoopworksActiveSpan,
} from "@/lib/observability/trace-context";
import type { LoopDefinition } from "../../../../../schemas/loop-manifest";

const inMemoryWebhookDeliveryStore = createInMemoryGithubWebhookDeliveryStore();

export const runtime = "nodejs";

const supportedGithubWebhookMetricEvents = new Set(["issues"]);
const supportedGithubWebhookMetricActions = new Set([
  "edited",
  "labeled",
  "milestoned",
  "opened",
  "reopened",
]);

type GithubWebhookPostDependencies = {
  developmentRunDatabase?: DevelopmentLoopRunDatabase;
  getAgentReadyTrigger?: (
    payload: GithubIssuesWebhookPayload,
    resolveLoop: GithubAgentReadyLoopResolver,
  ) => GithubAgentReadyTrigger;
  issueActivationManifests?: readonly LoopDefinition[];
  now?: () => Date;
  recordGithubWebhookOutcomeMetric?: (input: GithubWebhookOutcomeMetricInput) => void;
  resolveIssueActivationPermission?: (
    input: Parameters<
      ReturnType<typeof createGithubIssueActivationPermissionResolver>["resolve"]
    >[0],
  ) => Promise<GithubIssueActivationPermissionDecision>;
  resolveTrackedRepositoryBinding?: GithubIssueActivationRepositoryBindingResolver;
  webhookDeliveryStore?: GithubWebhookDeliveryStore;
};

type GithubWebhookDeliveryStoreMode = "drizzle" | "injected" | "memory";
type GithubWebhookRouteDependencies = {
  handlePost: typeof handleGithubWebhookPost;
  withSpan: typeof withLoopworksActiveSpan;
};
type DevelopmentRunOutcome = DevelopmentLoopRunMetadata | DevelopmentLoopNoopMetadata;
type ResearchRunOutcome = ResearchLoopRunMetadata | ResearchLoopNoopMetadata;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
  activation: NormalizedGithubIssueActivation | null,
  action: string | null,
): Record<string, unknown> {
  if (event !== "issues" || !activation) {
    return {
      ...(action ? { action } : {}),
      event,
    };
  }

  return compactRecord({
    action: activation.action,
    actorId: activation.actor.id,
    actorLogin: activation.actor.login,
    changedInput: activation.changedInput,
    event,
    installationId: activation.installationId,
    issueNumber: activation.issue.number,
    repositoryFullName: activation.repository.fullName,
    repositoryId: activation.repository.id,
  });
}

const loopEnabledEnvKeys = {
  development: "LOOPWORKS_DEVELOPMENT_LOOP_ENABLED",
  research: "LOOPWORKS_RESEARCH_LOOP_ENABLED",
} as const;

const resolveAgentReadyLoopState: GithubAgentReadyLoopResolver = (trigger) => ({
  enabled:
    readSuppliedBooleanConfig(loopEnabledEnvKeys[trigger.workflow]) ??
    readSuppliedBooleanConfig("LOOPWORKS_AGENT_READY_LOOP_ENABLED") ??
    true,
});

function getNextAction(
  agentReadyTrigger: GithubAgentReadyTrigger,
  developmentRun?: DevelopmentRunOutcome,
  researchRun?: ResearchRunOutcome,
): string {
  if (developmentRun?.mode === "deferred") return "await_dispatch_capacity";
  if (developmentRun?.mode === "lease_contention" || researchRun?.mode === "lease_contention") {
    return "observe_existing_run";
  }
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

function getVerifiedGithubWebhookMetricEvent(event: string): string {
  const normalizedEvent = event.trim().toLowerCase();
  return supportedGithubWebhookMetricEvents.has(normalizedEvent) ? normalizedEvent : "unsupported";
}

function getVerifiedGithubWebhookMetricAction(action: string | null | undefined): string {
  const normalizedAction = action?.trim().toLowerCase() ?? "none";
  return supportedGithubWebhookMetricActions.has(normalizedAction)
    ? normalizedAction
    : "unsupported";
}

function recordWebhookOutcomeSafely(
  recordMetric: (input: GithubWebhookOutcomeMetricInput) => void,
  input: GithubWebhookOutcomeMetricInput,
): void {
  try {
    recordMetric(input);
  } catch {
    // Webhook request handling must not depend on telemetry sink health.
  }
  markGithubWebhookActivationSpanOutcome({
    action: getVerifiedGithubWebhookMetricAction(input.action),
    outcome: input.outcome,
  });
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

function getApplicableManifest(
  activation: NormalizedGithubIssueActivation,
  manifests: readonly LoopDefinition[] = defaultLoopManifest.loops,
) {
  const loopKey = activation.issue.labels.includes("spike") ? "research-loop" : "development-loop";
  return manifests.find((loop) => loop.key === loopKey) ?? null;
}

function getDevelopmentLoopTrigger(
  payload: unknown,
  activation: NormalizedGithubIssueActivation,
  deliveryId: string,
): DevelopmentLoopTrigger | null {
  const issue = object(object(payload)?.issue);
  if (!issue) return null;

  return {
    body: string(issue.body) ?? "",
    deliveryId,
    issueNumber: activation.issue.number,
    issueUrl: string(issue.html_url) ?? undefined,
    labels: activation.issue.labels,
    milestone: activation.issue.milestone?.title ?? null,
    repositoryFullName: activation.repository.fullName,
    title: string(issue.title) ?? "",
  };
}

function getResearchLoopTrigger(
  payload: unknown,
  activation: NormalizedGithubIssueActivation,
  deliveryId: string,
): ResearchLoopTrigger | null {
  return getDevelopmentLoopTrigger(payload, activation, deliveryId);
}

function getSanitizedIssuesPayload(
  activation: NormalizedGithubIssueActivation,
): GithubIssuesWebhookPayload {
  return {
    action: activation.action,
    issue: {
      body: activation.issue.bodyPresent ? "present" : "",
      labels: activation.issue.labels.map((name) => ({ name })),
      milestone: activation.issue.milestone ? { title: activation.issue.milestone.title } : null,
      number: activation.issue.number,
      ...(activation.issue.isPullRequest ? { pull_request: {} } : {}),
      state: activation.issue.state,
    },
    repository: { full_name: activation.repository.fullName },
  };
}

async function resolveDevelopmentRunOutcome(input: {
  agentReadyTrigger: GithubAgentReadyTrigger;
  database: DevelopmentLoopRunDatabase;
  trigger: DevelopmentLoopTrigger | null;
  normalizedDeliveryId: string;
  now: Date;
  persist: boolean;
  traceId?: string;
}): Promise<DevelopmentRunOutcome | undefined> {
  const trigger = input.trigger;

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

async function resolveResearchRunOutcome(input: {
  agentReadyTrigger: GithubAgentReadyTrigger;
  database: DevelopmentLoopRunDatabase;
  trigger: ResearchLoopTrigger | null;
  normalizedDeliveryId: string;
  now: Date;
  persist: boolean;
  traceId?: string;
}): Promise<ResearchRunOutcome | undefined> {
  const trigger = input.trigger;

  if (
    input.agentReadyTrigger.shouldTrigger &&
    input.agentReadyTrigger.workflow === "research" &&
    trigger
  ) {
    if (input.persist) {
      return createResearchLoopRun({
        database: input.database,
        now: () => input.now,
        traceId: input.traceId,
        trigger,
      });
    }
    return simulateResearchLoopRun({ now: input.now, trigger });
  }

  if (
    !input.agentReadyTrigger.shouldTrigger &&
    input.agentReadyTrigger.skipped &&
    input.agentReadyTrigger.reason === "loop_disabled" &&
    input.agentReadyTrigger.workflow === "research" &&
    trigger
  ) {
    if (input.persist) {
      return recordResearchLoopNoop({
        database: input.database,
        now: () => input.now,
        reason: "loop_disabled",
        trigger,
      });
    }
    return { mode: "noop", reason: "loop_disabled" };
  }

  return undefined;
}

export async function handleGithubWebhookPost(
  request: Request,
  dependencies: GithubWebhookPostDependencies = {},
) {
  const webhookSecret = readStringConfig("GITHUB_WEBHOOK_SECRET");
  const deliveryId = request.headers.get("x-github-delivery");
  let normalizedHeaderDeliveryId: string | null = null;
  if (deliveryId) {
    try {
      normalizedHeaderDeliveryId = normalizeGithubDeliveryId(deliveryId);
    } catch {
      // Never attach an untrusted, malformed delivery value to logs or durable state.
    }
  }
  const event = request.headers.get("x-github-event") ?? "unknown";
  const metricEvent = getVerifiedGithubWebhookMetricEvent(event);
  const getAgentReadyTrigger =
    dependencies.getAgentReadyTrigger ?? getLoopAwareAgentReadyTriggerFromIssuesWebhook;
  const developmentRunDatabase = dependencies.developmentRunDatabase ?? db;
  const now = dependencies.now ?? (() => new Date());
  const recordWebhookOutcome =
    dependencies.recordGithubWebhookOutcomeMetric ?? recordGithubWebhookOutcomeMetric;
  const traceId = getActiveTraceId();
  const requestLogger = createRequestLogger({
    route: "api.github.webhooks",
    githubDeliveryId: normalizedHeaderDeliveryId ?? (deliveryId ? "invalid" : null),
    githubEvent: metricEvent,
  });

  if (!webhookSecret) {
    requestLogger.error("github_webhook_secret_missing");
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action: null,
      event: "unknown",
      outcome: "error",
    });
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
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action: null,
      event: "unknown",
      outcome: "ignored",
    });
    return NextResponse.json(
      {
        error: "Missing x-github-delivery header.",
      },
      { status: 400 },
    );
  }

  if (!normalizedHeaderDeliveryId) {
    requestLogger.warn("github_webhook_delivery_id_invalid");
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action: null,
      event: metricEvent,
      outcome: "ignored",
    });
    return NextResponse.json(
      {
        error: "Invalid x-github-delivery header.",
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
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action: null,
      event: "unknown",
      outcome: "invalid_signature",
    });
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
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action: null,
      event: metricEvent,
      outcome: "error",
    });
    return NextResponse.json(
      {
        error: "Webhook payload must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const action = string(object(payload)?.action)?.trim().toLowerCase() ?? null;
  const boundedAction = getVerifiedGithubWebhookMetricAction(action);
  const normalization =
    event === "issues"
      ? normalizeGithubIssueActivationPayload(payload)
      : ({ reason: "unsupported_event", success: false } as const);
  const activation = normalization.success ? normalization.activation : null;
  const normalizationFailureReason = normalization.success ? null : normalization.reason;
  const repositoryFullName = activation?.repository.fullName ?? null;
  const selectedDeliveryStore = dependencies.webhookDeliveryStore
    ? {
        mode: "injected" as const,
        store: dependencies.webhookDeliveryStore,
      }
    : getGithubWebhookDeliveryStore();
  const webhookDeliveryStore = selectedDeliveryStore.store;
  const webhookLogger = requestLogger.child({
    githubAction: getVerifiedGithubWebhookMetricAction(action),
    repositoryFullName,
    webhookDeliveryStore: selectedDeliveryStore.mode,
  });

  let claim: Awaited<ReturnType<typeof claimGithubWebhookDelivery>>;
  try {
    claim = await claimGithubWebhookDelivery({
      store: webhookDeliveryStore,
      deliveryId: normalizedHeaderDeliveryId,
      event: metricEvent,
      action: boundedAction,
      repositoryFullName,
      payload: summarizeGithubWebhookPayload(metricEvent, activation, boundedAction),
    });
  } catch (error) {
    webhookLogger.error(
      {
        failureType: getFailureType(error),
      },
      "github_webhook_claim_failed",
    );
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action,
      event: metricEvent,
      outcome: "error",
    });
    throw error;
  }

  if (!claim.accepted) {
    webhookLogger.info(
      {
        idempotencyKey: claim.key,
      },
      "github_webhook_duplicate_ignored",
    );
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action,
      event: metricEvent,
      outcome: "duplicate",
    });
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

  let authorizationAudit: Record<string, unknown> | undefined;
  try {
    const finishDecision = async (input: {
      authorization: Record<string, unknown>;
      deliveryStatus: "failed" | "ignored";
      outcome: Extract<
        GithubWebhookOutcome,
        "ignored" | "indeterminate" | "manifest_drift" | "unauthorized"
      >;
      reason: string;
      status: 202 | 503;
    }) => {
      authorizationAudit = input.authorization;
      const processedAt = now();
      await webhookDeliveryStore.complete(claim.key, {
        deliveryId: claim.deliveryId,
        metadata: {
          authorization: input.authorization,
          nextAction: "record_and_ignore",
          triggerWorkflow: "none",
        },
        processedAt: processedAt.toISOString(),
        status: input.deliveryStatus,
      });
      webhookLogger.info(
        {
          authorizationOutcome: input.outcome,
          authorizationReason: input.reason,
          idempotencyKey: claim.key,
        },
        "github_webhook_activation_decided",
      );
      recordWebhookOutcomeSafely(recordWebhookOutcome, {
        action,
        event: metricEvent,
        outcome: input.outcome,
      });
      return NextResponse.json(
        {
          accepted: input.status === 202,
          authorization: input.authorization,
          deliveryId: claim.deliveryId,
          duplicate: false,
          idempotencyKey: claim.key,
          nextAction: "record_and_ignore",
          ...(input.status === 503 ? { retryable: true } : {}),
          ...getFixtureFallbackResponse(selectedDeliveryStore.mode),
        },
        { status: input.status },
      );
    };

    if (!activation) {
      return finishDecision({
        authorization: {
          action: boundedAction,
          outcome: "ignored",
          reason: normalizationFailureReason ?? "invalid_activation_envelope",
        },
        deliveryStatus: "ignored",
        outcome: "ignored",
        reason: normalizationFailureReason ?? "invalid_activation_envelope",
        status: 202,
      });
    }

    const manifest = getApplicableManifest(
      activation,
      dependencies.issueActivationManifests ?? defaultLoopManifest.loops,
    );
    if (!manifest) {
      return finishDecision({
        authorization: {
          action: activation.action,
          actor: activation.actor,
          outcome: "manifest_drift",
          reason: "applicable_manifest_missing",
        },
        deliveryStatus: "ignored",
        outcome: "manifest_drift",
        reason: "applicable_manifest_missing",
        status: 202,
      });
    }
    const transition = evaluateGithubIssueActivationTransition({ activation, manifest });
    const baseAudit = {
      action: activation.action,
      actor: activation.actor,
      binding: {
        deliveryId: claim.deliveryId,
        installationId: activation.installationId,
        repositoryFullName: activation.repository.fullName,
        repositoryId: activation.repository.id,
      },
      transition,
    };
    authorizationAudit = baseAudit;
    if (transition.outcome !== "eligible") {
      return finishDecision({
        authorization: {
          ...baseAudit,
          outcome: transition.outcome,
          reason: transition.reason,
        },
        deliveryStatus: "ignored",
        outcome: transition.outcome,
        reason: transition.reason,
        status: 202,
      });
    }

    const resolveBinding =
      dependencies.resolveTrackedRepositoryBinding ??
      createGithubIssueActivationRepositoryBindingResolver();
    let binding: GithubIssueActivationRepositoryBindingDecision;
    try {
      binding = await resolveBinding(activation);
    } catch {
      binding = { decision: "indeterminate", reason: "repository_binding_missing_or_mismatched" };
    }
    if (binding.decision === "indeterminate") {
      return finishDecision({
        authorization: {
          ...baseAudit,
          bindingDecision: binding,
          outcome: "indeterminate",
          reason: binding.reason,
        },
        deliveryStatus: "failed",
        outcome: "indeterminate",
        reason: binding.reason,
        status: 503,
      });
    }
    authorizationAudit = { ...baseAudit, bindingDecision: binding };

    const resolvePermission =
      dependencies.resolveIssueActivationPermission ??
      createGithubIssueActivationPermissionResolver().resolve;
    let permission: GithubIssueActivationPermissionDecision;
    try {
      permission = await resolvePermission({
        actor: activation.actor,
        installationId: activation.installationId,
        owner: binding.owner,
        repo: binding.repo,
      });
    } catch {
      permission = { decision: "indeterminate", reason: "github_permission_unavailable" };
    }
    if (permission.decision === "indeterminate") {
      return finishDecision({
        authorization: {
          ...baseAudit,
          bindingDecision: binding,
          outcome: "indeterminate",
          permission,
          reason: permission.reason,
        },
        deliveryStatus: "failed",
        outcome: "indeterminate",
        reason: permission.reason,
        status: 503,
      });
    }
    if (permission.decision === "unauthorized") {
      return finishDecision({
        authorization: {
          ...baseAudit,
          bindingDecision: binding,
          outcome: "unauthorized",
          permission,
          reason: "permission_below_triage",
        },
        deliveryStatus: "ignored",
        outcome: "unauthorized",
        reason: "permission_below_triage",
        status: 202,
      });
    }
    authorizationAudit = {
      ...baseAudit,
      bindingDecision: binding,
      outcome: "authorized",
      permission,
    };

    const sanitizedIssuesPayload = getSanitizedIssuesPayload(activation);
    const agentReadyTrigger = getAgentReadyTrigger(
      sanitizedIssuesPayload,
      resolveAgentReadyLoopState,
    );
    const processedAt = now();
    const developmentTrigger = getDevelopmentLoopTrigger(payload, activation, claim.deliveryId);
    const researchTrigger = getResearchLoopTrigger(payload, activation, claim.deliveryId);
    const developmentRun = await resolveDevelopmentRunOutcome({
      agentReadyTrigger,
      database: developmentRunDatabase,
      normalizedDeliveryId: claim.deliveryId,
      now: processedAt,
      persist:
        selectedDeliveryStore.mode === "drizzle" || Boolean(dependencies.developmentRunDatabase),
      traceId,
      trigger: developmentTrigger,
    });
    const researchRun = await resolveResearchRunOutcome({
      agentReadyTrigger,
      database: developmentRunDatabase,
      normalizedDeliveryId: claim.deliveryId,
      now: processedAt,
      persist:
        selectedDeliveryStore.mode === "drizzle" || Boolean(dependencies.developmentRunDatabase),
      traceId,
      trigger: researchTrigger,
    });
    const nextAction = getNextAction(agentReadyTrigger, developmentRun, researchRun);
    const run = developmentRun ?? researchRun;
    const runId = run && "runId" in run ? run.runId : undefined;
    const authorization = {
      ...baseAudit,
      bindingDecision: binding,
      outcome: "authorized",
      permission,
      ...(runId ? { runId } : {}),
    };
    authorizationAudit = authorization;

    await webhookDeliveryStore.complete(claim.key, {
      deliveryId: claim.deliveryId,
      metadata: {
        authorization,
        ...(developmentRun ? { developmentRun } : {}),
        ...(researchRun ? { researchRun } : {}),
        nextAction,
        triggerReason: agentReadyTrigger.reason,
        triggerWorkflow: agentReadyTrigger.workflow ?? "none",
      },
      processedAt: processedAt.toISOString(),
      status: "processed",
    });

    webhookLogger.info(
      {
        authorizationOutcome: "authorized",
        idempotencyKey: claim.key,
        nextAction,
        triggerWorkflow: agentReadyTrigger.workflow ?? "none",
      },
      "github_webhook_processed",
    );
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action,
      event: metricEvent,
      outcome: "authorized",
    });

    return NextResponse.json(
      {
        accepted: true,
        authorization,
        duplicate: false,
        deliveryId: claim.deliveryId,
        idempotencyKey: claim.key,
        event: metricEvent,
        agentReadyTrigger,
        ...(developmentRun ? { developmentRun } : {}),
        ...(researchRun ? { researchRun } : {}),
        nextAction,
        ...getFixtureFallbackResponse(selectedDeliveryStore.mode),
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
    recordWebhookOutcomeSafely(recordWebhookOutcome, {
      action,
      event: metricEvent,
      outcome: "error",
    });

    try {
      await webhookDeliveryStore.complete(claim.key, {
        deliveryId: claim.deliveryId,
        metadata: {
          ...(authorizationAudit ? { authorization: authorizationAudit } : {}),
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

export async function runGithubWebhookPostRoute(
  request: Request,
  dependencies: Partial<GithubWebhookRouteDependencies> = {},
) {
  return (dependencies.withSpan ?? withLoopworksActiveSpan)(
    "github.webhook.activation",
    async (span) => {
      try {
        return await (dependencies.handlePost ?? handleGithubWebhookPost)(request);
      } finally {
        span.end();
      }
    },
  );
}

export async function POST(request: Request) {
  return runGithubWebhookPostRoute(request);
}
