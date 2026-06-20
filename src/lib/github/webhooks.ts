import { createHmac, timingSafeEqual } from "node:crypto";

import { isProductionRuntime } from "@/lib/runtime";

const githubSignaturePrefix = "sha256=";
const triggerableIssueActions = new Set(["edited", "labeled", "milestoned", "opened", "reopened"]);

export type GithubWebhookDeliveryStore = {
  claim: (
    key: string,
    record: {
      deliveryId: string;
      event: string;
      action?: string;
      receivedAt: string;
      repositoryFullName?: string;
    },
  ) => boolean | Promise<boolean>;
};

export type GithubWebhookLabel = {
  name?: string | null;
};

export type GithubWebhookIssue = {
  number: number;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  milestone?: { title?: string | null } | null;
  labels?: GithubWebhookLabel[] | null;
  html_url?: string | null;
  pull_request?: Record<string, unknown> | null;
};

export type GithubIssuesWebhookPayload = {
  action?: string | null;
  issue?: GithubWebhookIssue | null;
  repository?: { full_name?: string | null } | null;
};

export type GithubAgentReadyRules = {
  readyLabels: string[];
  blockedLabels: string[];
  requiredLabelPrefixes: string[];
  requiresMilestone: boolean;
  requiresBody: boolean;
};

export type GithubIssueReadiness =
  | { ready: true; reason: "ready"; labels: string[] }
  | { ready: false; reason: string; labels: string[] };

export type GithubAgentReadyTrigger =
  | {
      shouldTrigger: true;
      issueNumber: number;
      repositoryFullName?: string;
      workflow: "development" | "research";
      reason: "issue_became_agent_ready";
    }
  | {
      shouldTrigger: false;
      reason: string;
    };

export const defaultGithubAgentReadyRules: GithubAgentReadyRules = {
  readyLabels: ["agent-ready"],
  blockedLabels: ["status:blocked"],
  requiredLabelPrefixes: ["area:", "priority:"],
  requiresMilestone: true,
  requiresBody: true,
};

function toBuffer(payload: string | Uint8Array): Buffer {
  return typeof payload === "string" ? Buffer.from(payload) : Buffer.from(payload);
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function getIssueLabels(issue: GithubWebhookIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => label.name?.trim().toLowerCase())
    .filter((label): label is string => Boolean(label));
}

export function createGithubWebhookSignature(secret: string, payload: string | Uint8Array): string {
  return `${githubSignaturePrefix}${createHmac("sha256", secret).update(toBuffer(payload)).digest("hex")}`;
}

export function verifyGithubWebhookSignature(input: {
  secret: string;
  payload: string | Uint8Array;
  signature: string | null | undefined;
}): boolean {
  if (!input.signature) {
    return false;
  }

  const expected = createGithubWebhookSignature(input.secret, input.payload);
  const actual = input.signature.trim();

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function normalizeGithubDeliveryId(deliveryId: string): string {
  const normalized = deliveryId.trim().toLowerCase();
  if (!normalized) {
    throw new Error("GitHub delivery id is required.");
  }

  return normalized;
}

export function buildGithubWebhookIdempotencyKey(deliveryId: string): string {
  return `github:${normalizeGithubDeliveryId(deliveryId)}`;
}

export async function claimGithubWebhookDelivery(input: {
  store: GithubWebhookDeliveryStore;
  deliveryId: string;
  event: string;
  action?: string | null;
  repositoryFullName?: string | null;
  receivedAt?: Date;
}): Promise<{
  accepted: boolean;
  key: string;
  deliveryId: string;
}> {
  const normalizedDeliveryId = normalizeGithubDeliveryId(input.deliveryId);
  const key = buildGithubWebhookIdempotencyKey(normalizedDeliveryId);
  const accepted = await input.store.claim(key, {
    deliveryId: normalizedDeliveryId,
    event: input.event,
    ...(input.action ? { action: input.action } : {}),
    receivedAt: (input.receivedAt ?? new Date()).toISOString(),
    ...(input.repositoryFullName ? { repositoryFullName: input.repositoryFullName } : {}),
  });

  return {
    accepted,
    key,
    deliveryId: normalizedDeliveryId,
  };
}

export function createInMemoryGithubWebhookDeliveryStore(): GithubWebhookDeliveryStore {
  const claimedKeys = new Set<string>();

  return {
    claim(key) {
      if (claimedKeys.has(key)) {
        return false;
      }

      claimedKeys.add(key);
      return true;
    },
  };
}

export function canUseInMemoryGithubWebhookDeliveryStore(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  return !isProductionRuntime(env);
}

export function evaluateGithubIssueReadiness(
  issue: GithubWebhookIssue,
  rules: GithubAgentReadyRules = defaultGithubAgentReadyRules,
): GithubIssueReadiness {
  const labels = getIssueLabels(issue);

  if (issue.pull_request) {
    return {
      ready: false,
      reason: "pull_request_payload",
      labels,
    };
  }

  if ((issue.state ?? "").toLowerCase() !== "open") {
    return {
      ready: false,
      reason: "issue_not_open",
      labels,
    };
  }

  if (rules.blockedLabels.some((label) => labels.includes(normalizeLabel(label)))) {
    return {
      ready: false,
      reason: "issue_blocked",
      labels,
    };
  }

  if (!rules.readyLabels.some((label) => labels.includes(normalizeLabel(label)))) {
    return {
      ready: false,
      reason: "missing_ready_label",
      labels,
    };
  }

  if (rules.requiresMilestone && !issue.milestone?.title?.trim()) {
    return {
      ready: false,
      reason: "missing_milestone",
      labels,
    };
  }

  const missingPrefix = rules.requiredLabelPrefixes.find(
    (prefix) => !labels.some((label) => label.startsWith(normalizeLabel(prefix))),
  );

  if (missingPrefix) {
    return {
      ready: false,
      reason: `missing_required_label_prefix:${missingPrefix}`,
      labels,
    };
  }

  if (rules.requiresBody && !issue.body?.trim()) {
    return {
      ready: false,
      reason: "missing_issue_body",
      labels,
    };
  }

  return {
    ready: true,
    reason: "ready",
    labels,
  };
}

export function getAgentReadyTriggerFromIssuesWebhook(
  payload: GithubIssuesWebhookPayload,
  rules: GithubAgentReadyRules = defaultGithubAgentReadyRules,
): GithubAgentReadyTrigger {
  const action = payload.action?.trim().toLowerCase() ?? "";
  if (!triggerableIssueActions.has(action)) {
    return {
      shouldTrigger: false,
      reason: "unsupported_action",
    };
  }

  if (!payload.issue) {
    return {
      shouldTrigger: false,
      reason: "missing_issue",
    };
  }

  const readiness = evaluateGithubIssueReadiness(payload.issue, rules);
  if (!readiness.ready) {
    return {
      shouldTrigger: false,
      reason: readiness.reason,
    };
  }

  return {
    shouldTrigger: true,
    issueNumber: payload.issue.number,
    repositoryFullName: payload.repository?.full_name ?? undefined,
    workflow: readiness.labels.includes("spike") ? "research" : "development",
    reason: "issue_became_agent_ready",
  };
}
