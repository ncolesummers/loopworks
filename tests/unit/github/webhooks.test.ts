import {
  handleGithubWebhookPost,
  runGithubWebhookPostRoute,
} from "@/app/api/github/webhooks/route";
import {
  canUseInMemoryGithubWebhookDeliveryStore,
  claimGithubWebhookDelivery,
  createGithubWebhookSignature,
  createInMemoryGithubWebhookDeliveryStore,
  defaultGithubAgentReadyRules,
  evaluateGithubIssueReadiness,
  type GithubWebhookDeliveryStore,
  getAgentReadyTriggerFromIssuesWebhook,
  getLoopAwareAgentReadyTriggerFromIssuesWebhook,
  normalizeGithubDeliveryId,
  verifyGithubWebhookSignature,
} from "@/lib/github/webhooks";
import { defaultLoopManifest } from "@/lib/loops/manifest";
import { createGithubWebhookFixture } from "../../../scripts/github-webhook-fixture";

function createWebhookOutcomeRecorder() {
  const recordings: {
    action?: string | null;
    event: string;
    outcome:
      | "authorized"
      | "unauthorized"
      | "indeterminate"
      | "duplicate"
      | "manifest_drift"
      | "ignored"
      | "invalid_signature"
      | "error";
  }[] = [];

  return {
    recordGithubWebhookOutcomeMetric(input: (typeof recordings)[number]) {
      recordings.push(input);
    },
    recordings,
  };
}

function authorizedActivationDependencies() {
  return {
    resolveIssueActivationPermission: vi.fn(async () => ({
      decision: "authorized" as const,
      permission: "read",
      roleName: "triage",
    })),
    resolveTrackedRepositoryBinding: vi.fn(async () => ({
      decision: "bound" as const,
      installationId: 124_001,
      owner: "ncolesummers",
      repo: "loopworks",
      repositoryId: 11_000_001,
    })),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GitHub webhook helpers", () => {
  it("rejects unbounded or unsafe delivery identifiers", () => {
    expect(() => normalizeGithubDeliveryId("x".repeat(129))).toThrow(
      "GitHub delivery id must be a bounded identifier.",
    );
    expect(() => normalizeGithubDeliveryId("Bearer credential-material")).toThrow(
      "GitHub delivery id must be a bounded identifier.",
    );
  });

  it("owns and ends an active authorization span around route ingress", async () => {
    const span = { end: vi.fn() };
    const handlePost = vi.fn(async () => new Response(null, { status: 204 }));
    const withSpan = vi.fn(
      async (_name: string, callback: (ownedSpan: never) => Promise<unknown>) =>
        callback(span as never),
    );

    const response = await runGithubWebhookPostRoute(
      new Request("https://loopworks.local/api/github/webhooks", { method: "POST" }),
      { handlePost: handlePost as never, withSpan: withSpan as never },
    );

    expect(response.status).toBe(204);
    expect(withSpan).toHaveBeenCalledWith("github.webhook.activation", expect.any(Function));
    expect(handlePost).toHaveBeenCalledOnce();
    expect(span.end).toHaveBeenCalledOnce();
  });

  it("verifies the webhook signature", () => {
    const payload = JSON.stringify({ hello: "world" });
    const signature = createGithubWebhookSignature("secret", payload);

    expect(
      verifyGithubWebhookSignature({
        secret: "secret",
        payload,
        signature,
      }),
    ).toBe(true);
  });

  it("claims a delivery only once", async () => {
    const store = createInMemoryGithubWebhookDeliveryStore();

    const first = await claimGithubWebhookDelivery({
      store,
      deliveryId: "delivery-1",
      event: "issues",
    });
    const second = await claimGithubWebhookDelivery({
      store,
      deliveryId: "delivery-1",
      event: "issues",
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(first.key).toBe(second.key);
  });

  it("keeps in-memory delivery completion behavior aligned with durable stores", async () => {
    const store = createInMemoryGithubWebhookDeliveryStore();
    const first = await claimGithubWebhookDelivery({
      store,
      deliveryId: "memory-redelivery",
      event: "issues",
    });

    expect(store.complete).toBeDefined();
    if (!store.complete) {
      throw new Error("Expected in-memory webhook delivery store to implement complete().");
    }

    await store.complete(first.key, {
      deliveryId: first.deliveryId,
      processedAt: "2026-06-28T01:00:00.000Z",
      status: "failed",
    });
    const retry = await claimGithubWebhookDelivery({
      store,
      deliveryId: "memory-redelivery",
      event: "issues",
    });

    await store.complete(retry.key, {
      deliveryId: retry.deliveryId,
      processedAt: "2026-06-28T01:00:01.000Z",
      status: "processed",
    });
    const duplicate = await claimGithubWebhookDelivery({
      store,
      deliveryId: "memory-redelivery",
      event: "issues",
    });

    expect(first.accepted).toBe(true);
    expect(retry.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
  });

  it("does not expose mutable default agent-ready readiness rules", () => {
    expect(Object.isFrozen(defaultGithubAgentReadyRules)).toBe(true);
    expect(Object.isFrozen(defaultGithubAgentReadyRules.readyLabels)).toBe(true);
    expect(Object.isFrozen(defaultGithubAgentReadyRules.blockedLabels)).toBe(true);
    expect(Object.isFrozen(defaultGithubAgentReadyRules.requiredLabelPrefixes)).toBe(true);
  });

  it("detects an agent-ready issue", () => {
    const readiness = evaluateGithubIssueReadiness({
      number: 42,
      title: "Implement deployment summaries",
      body: "Track preview URLs and map them to issue state.",
      state: "open",
      milestone: {
        title: "M2 GitHub + Vercel Source Systems",
      },
      labels: [{ name: "agent-ready" }, { name: "area:vercel" }, { name: "priority:p1" }],
    });

    expect(readiness).toEqual({
      ready: true,
      reason: "ready",
      labels: ["agent-ready", "area:vercel", "priority:p1"],
    });
  });

  it("returns a planning trigger for an agent-ready issues webhook", () => {
    const trigger = getAgentReadyTriggerFromIssuesWebhook({
      action: "labeled",
      repository: {
        full_name: "ncolesummers/loopworks",
      },
      issue: {
        number: 42,
        title: "Implement deployment summaries",
        body: "Track preview URLs and map them to issue state.",
        state: "open",
        milestone: {
          title: "M2 GitHub + Vercel Source Systems",
        },
        labels: [{ name: "agent-ready" }, { name: "area:vercel" }, { name: "priority:p1" }],
      },
    });

    expect(trigger).toEqual({
      shouldTrigger: true,
      issueNumber: 42,
      repositoryFullName: "ncolesummers/loopworks",
      workflow: "development",
      reason: "issue_became_agent_ready",
    });
  });

  it("routes spike agent-ready issues to the research workflow", () => {
    const trigger = getAgentReadyTriggerFromIssuesWebhook({
      action: "labeled",
      repository: {
        full_name: "ncolesummers/loopworks",
      },
      issue: {
        number: 43,
        title: "Research Vercel deployment log options",
        body: "Find the pragmatic deployment event and log summary API path.",
        state: "open",
        milestone: {
          title: "M2 GitHub + Vercel Source Systems",
        },
        labels: [
          { name: "agent-ready" },
          { name: "spike" },
          { name: "area:vercel" },
          { name: "priority:p1" },
        ],
      },
    });

    expect(trigger).toMatchObject({
      shouldTrigger: true,
      workflow: "research",
    });
  });

  it("does not start research runs for issue actions outside the manifest", () => {
    const trigger = getAgentReadyTriggerFromIssuesWebhook({
      action: "edited",
      repository: { full_name: "ncolesummers/loopworks" },
      issue: {
        body: "An ordinary edit must not create another research run.",
        labels: [
          { name: "agent-ready" },
          { name: "spike" },
          { name: "area:loops" },
          { name: "priority:p2" },
        ],
        milestone: { title: "M3 Durable Loop MVP" },
        number: 43,
        state: "open",
      },
    });

    expect(trigger).toEqual({ shouldTrigger: false, reason: "unsupported_action" });
  });

  it("skips an agent-ready issue before queueing when the target loop is disabled", () => {
    const resolveLoop = vi.fn(() => ({ enabled: false }));
    const trigger = getLoopAwareAgentReadyTriggerFromIssuesWebhook(
      {
        action: "labeled",
        repository: {
          full_name: "ncolesummers/loopworks",
        },
        issue: {
          number: 44,
          title: "Implement disabled loop handling",
          body: "Disabled loops must record a skipped reason.",
          state: "open",
          milestone: {
            title: "M3 Durable Loop MVP",
          },
          labels: [{ name: "agent-ready" }, { name: "area:loops" }, { name: "priority:p0" }],
        },
      },
      resolveLoop,
    );

    expect(resolveLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 44,
        workflow: "development",
      }),
    );
    expect(trigger).toEqual({
      shouldTrigger: false,
      issueNumber: 44,
      repositoryFullName: "ncolesummers/loopworks",
      reason: "loop_disabled",
      skipped: true,
      workflow: "development",
    });
  });

  it("preserves the research workflow when a spike loop is disabled", () => {
    const resolveLoop = vi.fn(() => ({ enabled: false }));
    const trigger = getLoopAwareAgentReadyTriggerFromIssuesWebhook(
      {
        action: "labeled",
        repository: {
          full_name: "ncolesummers/loopworks",
        },
        issue: {
          number: 45,
          title: "Research disabled loop handling",
          body: "Disabled research loops must not be audited as development loops.",
          state: "open",
          milestone: {
            title: "M3 Durable Loop MVP",
          },
          labels: [
            { name: "agent-ready" },
            { name: "spike" },
            { name: "area:loops" },
            { name: "priority:p0" },
          ],
        },
      },
      resolveLoop,
    );

    expect(resolveLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 45,
        workflow: "research",
      }),
    );
    expect(trigger).toEqual({
      shouldTrigger: false,
      issueNumber: 45,
      repositoryFullName: "ncolesummers/loopworks",
      reason: "loop_disabled",
      skipped: true,
      workflow: "research",
    });
  });

  it("keeps the in-memory webhook store out of production", () => {
    expect(
      canUseInMemoryGithubWebhookDeliveryStore({
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(
      canUseInMemoryGithubWebhookDeliveryStore({
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("rejects an invalid signature before parsing the webhook payload with bounded metric attributes", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const claim = vi.fn();
    const complete = vi.fn();
    const resolveIssueActivationPermission = vi.fn();
    const resolveTrackedRepositoryBinding = vi.fn();

    const response = await handleGithubWebhookPost(
      new Request("https://loopworks.local/api/github/webhooks", {
        method: "POST",
        headers: {
          "x-github-delivery": "invalid-json-delivery",
          "x-github-event": "attacker-controlled-event",
          "x-hub-signature-256": "sha256=invalid",
        },
        body: "{not-valid-json",
      }),
      {
        recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
        resolveIssueActivationPermission,
        resolveTrackedRepositoryBinding,
        webhookDeliveryStore: { claim, complete },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid GitHub webhook signature.",
    });
    expect(webhookOutcome.recordings).toEqual([
      {
        action: null,
        event: "unknown",
        outcome: "invalid_signature",
      },
    ]);
    expect(claim).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(resolveTrackedRepositoryBinding).not.toHaveBeenCalled();
    expect(resolveIssueActivationPermission).not.toHaveBeenCalled();
  });

  it("rejects an unsafe delivery header before logging or persistence", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const claim = vi.fn();
    const response = await handleGithubWebhookPost(
      new Request("https://loopworks.local/api/github/webhooks", {
        body: "{}",
        headers: {
          "x-github-delivery": "Bearer credential-material",
          "x-github-event": "issues",
          "x-hub-signature-256": createGithubWebhookSignature("secret", "{}"),
        },
        method: "POST",
      }),
      { webhookDeliveryStore: { claim, complete: vi.fn() } },
    );

    expect(response.status).toBe(400);
    expect(claim).not.toHaveBeenCalled();
  });

  it("skips a disabled development loop at the route boundary before queueing", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("LOOPWORKS_DEVELOPMENT_LOOP_ENABLED", "false");
    const payload = JSON.stringify({
      action: "labeled",
      installation: { id: 124_001 },
      label: { name: "agent-ready" },
      repository: {
        full_name: "ncolesummers/loopworks",
        id: 11_000_001,
      },
      sender: { id: 22_808_397, login: "ncolesummers" },
      issue: {
        number: 58,
        title: "Route disabled loop skips",
        body: "Exercise disabled loop behavior before queueing.",
        state: "open",
        milestone: {
          id: 31,
          title: "M3 Durable Loop MVP",
        },
        labels: [{ name: "agent-ready" }, { name: "area:loop" }, { name: "priority:p0" }],
      },
    });
    const signature = createGithubWebhookSignature("secret", payload);

    const response = await handleGithubWebhookPost(
      new Request("https://loopworks.local/api/github/webhooks", {
        method: "POST",
        headers: {
          "x-github-delivery": "disabled-loop-route-delivery",
          "x-github-event": "issues",
          "x-hub-signature-256": signature,
        },
        body: payload,
      }),
      {
        ...authorizedActivationDependencies(),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      },
    );

    expect(response.status).toBe(202);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      accepted: true,
      duplicate: false,
      agentReadyTrigger: {
        shouldTrigger: false,
        reason: "loop_disabled",
        skipped: true,
        workflow: "development",
      },
      developmentRun: {
        mode: "noop",
        reason: "loop_disabled",
      },
      nextAction: "record_and_ignore",
    });
  });

  it("ignores duplicate webhook deliveries at the route boundary", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const payload = JSON.stringify({
      action: "labeled",
      installation: { id: 124_001 },
      label: { name: "agent-ready" },
      repository: {
        full_name: "ncolesummers/loopworks",
        id: 11_000_001,
      },
      sender: { id: 22_808_397, login: "ncolesummers" },
      issue: {
        number: 57,
        title: "Implement persona coverage",
        body: "Exercise webhook idempotency.",
        state: "open",
        milestone: {
          id: 31,
          title: "M1 Design System Direction + App Shell",
        },
        labels: [{ name: "agent-ready" }, { name: "area:validation" }, { name: "priority:p0" }],
      },
    });
    const signature = createGithubWebhookSignature("secret", payload);
    const makeRequest = () =>
      new Request("https://loopworks.local/api/github/webhooks", {
        method: "POST",
        headers: {
          "x-github-delivery": "duplicate-route-delivery",
          "x-github-event": "issues",
          "x-hub-signature-256": signature,
        },
        body: payload,
      });

    const store = createInMemoryGithubWebhookDeliveryStore();
    const first = await handleGithubWebhookPost(makeRequest(), {
      ...authorizedActivationDependencies(),
      webhookDeliveryStore: store,
    });
    const second = await handleGithubWebhookPost(makeRequest(), {
      ...authorizedActivationDependencies(),
      recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
      webhookDeliveryStore: store,
    });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      accepted: false,
      duplicate: true,
      deliveryId: "duplicate-route-delivery",
      idempotencyKey: "github:duplicate-route-delivery",
    });
    expect(webhookOutcome.recordings).toEqual([
      {
        action: "labeled",
        event: "issues",
        outcome: "duplicate",
      },
    ]);
  });

  it("records a failed outcome when delivery claiming throws", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const store: GithubWebhookDeliveryStore = {
      claim: vi.fn(() => {
        throw new Error("claim failed");
      }),
      complete: vi.fn(),
    };
    const fixture = createGithubWebhookFixture({
      deliveryId: "claim-failure-route-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    await expect(
      handleGithubWebhookPost(
        new Request(fixture.url, {
          body: fixture.payloadText,
          headers: fixture.headers,
          method: "POST",
        }),
        {
          recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
          webhookDeliveryStore: store,
        },
      ),
    ).rejects.toThrow("claim failed");

    expect(webhookOutcome.recordings).toEqual([
      {
        action: "labeled",
        event: "issues",
        outcome: "error",
      },
    ]);
  });

  it("accepts a signed agent-ready fixture as a development trigger", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const fixture = createGithubWebhookFixture({
      deliveryId: "fixture-agent-ready-route-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    const response = await handleGithubWebhookPost(
      new Request(fixture.url, {
        body: fixture.payloadText,
        headers: fixture.headers,
        method: "POST",
      }),
      {
        ...authorizedActivationDependencies(),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      },
    );

    expect(response.status).toBe(202);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      accepted: true,
      agentReadyTrigger: {
        shouldTrigger: true,
        workflow: "development",
      },
      developmentRun: {
        artifactCount: 10,
        mode: "simulated",
        stageCount: 8,
      },
      nextAction: "queue_planning_agent",
    });
  });

  it("accepts a signed spike agent-ready fixture as a research trigger", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const fixture = createGithubWebhookFixture({
      deliveryId: "fixture-spike-agent-ready-route-delivery",
      kind: "spike-agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    const response = await handleGithubWebhookPost(
      new Request(fixture.url, {
        body: fixture.payloadText,
        headers: fixture.headers,
        method: "POST",
      }),
      {
        ...authorizedActivationDependencies(),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      },
    );

    expect(response.status).toBe(202);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      accepted: true,
      agentReadyTrigger: {
        shouldTrigger: true,
        workflow: "research",
      },
      nextAction: "queue_deep_research_loop",
      researchRun: {
        artifactCount: 4,
        mode: "simulated",
        stageCount: 4,
      },
    });
    expect(responseBody).not.toHaveProperty("developmentRun");
  });

  it("records a failed outcome when accepted delivery processing throws", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const complete = vi.fn();
    const store: GithubWebhookDeliveryStore = {
      claim: vi.fn(() => true),
      complete,
    };
    const fixture = createGithubWebhookFixture({
      deliveryId: "failed-processing-route-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    await expect(
      handleGithubWebhookPost(
        new Request(fixture.url, {
          body: fixture.payloadText,
          headers: fixture.headers,
          method: "POST",
        }),
        {
          ...authorizedActivationDependencies(),
          getAgentReadyTrigger() {
            throw new Error("classification failed");
          },
          now: () => new Date("2026-06-28T01:00:03.000Z"),
          recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
          webhookDeliveryStore: store,
        },
      ),
    ).rejects.toThrow("classification failed");

    expect(complete).toHaveBeenCalledWith("github:failed-processing-route-delivery", {
      deliveryId: "failed-processing-route-delivery",
      metadata: {
        authorization: expect.objectContaining({
          action: "labeled",
          actor: { id: 22_808_397, login: "ncolesummers" },
          bindingDecision: expect.objectContaining({ decision: "bound" }),
          outcome: "authorized",
          permission: expect.objectContaining({ decision: "authorized" }),
          transition: expect.objectContaining({ outcome: "eligible" }),
        }),
        failureType: "Error",
        nextAction: "record_and_ignore",
        triggerWorkflow: "none",
      },
      processedAt: "2026-06-28T01:00:03.000Z",
      status: "failed",
    });
    expect(webhookOutcome.recordings).toEqual([
      {
        action: "labeled",
        event: "issues",
        outcome: "error",
      },
    ]);
  });

  it("records a processed outcome on the accepted success path", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const complete = vi.fn();
    const store: GithubWebhookDeliveryStore = {
      claim: vi.fn(() => true),
      complete,
    };
    const fixture = createGithubWebhookFixture({
      deliveryId: "successful-processing-route-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    const response = await handleGithubWebhookPost(
      new Request(fixture.url, {
        body: fixture.payloadText,
        headers: fixture.headers,
        method: "POST",
      }),
      {
        ...authorizedActivationDependencies(),
        now: () => new Date("2026-06-28T01:00:04.000Z"),
        recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
        webhookDeliveryStore: store,
      },
    );

    expect(response.status).toBe(202);
    expect(complete).toHaveBeenCalledWith(
      "github:successful-processing-route-delivery",
      expect.objectContaining({
        deliveryId: "successful-processing-route-delivery",
        metadata: expect.objectContaining({
          authorization: expect.objectContaining({ outcome: "authorized" }),
          developmentRun: {
            artifactCount: 10,
            mode: "simulated",
            stageCount: 8,
          },
          nextAction: "queue_planning_agent",
          triggerReason: "issue_became_agent_ready",
          triggerWorkflow: "development",
        }),
        processedAt: "2026-06-28T01:00:04.000Z",
        status: "processed",
      }),
    );
    expect(webhookOutcome.recordings).toEqual([
      {
        action: "labeled",
        event: "issues",
        outcome: "authorized",
      },
    ]);
  });

  it("retains authorized audit evidence when an injected loop classifier declines", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    const webhookOutcome = createWebhookOutcomeRecorder();
    const complete = vi.fn();
    const store: GithubWebhookDeliveryStore = {
      claim: vi.fn(() => true),
      complete,
    };
    const fixture = createGithubWebhookFixture({
      deliveryId: "ignored-processing-route-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });

    const response = await handleGithubWebhookPost(
      new Request(fixture.url, {
        body: fixture.payloadText,
        headers: fixture.headers,
        method: "POST",
      }),
      {
        ...authorizedActivationDependencies(),
        getAgentReadyTrigger: () => ({ shouldTrigger: false, reason: "missing_ready_label" }),
        now: () => new Date("2026-06-28T01:00:05.000Z"),
        recordGithubWebhookOutcomeMetric: webhookOutcome.recordGithubWebhookOutcomeMetric,
        webhookDeliveryStore: store,
      },
    );

    expect(response.status).toBe(202);
    expect(complete).toHaveBeenCalledWith(
      "github:ignored-processing-route-delivery",
      expect.objectContaining({
        deliveryId: "ignored-processing-route-delivery",
        metadata: expect.objectContaining({
          authorization: expect.objectContaining({ outcome: "authorized" }),
          nextAction: "record_and_ignore",
          triggerReason: "missing_ready_label",
          triggerWorkflow: "none",
        }),
        processedAt: "2026-06-28T01:00:05.000Z",
        status: "processed",
      }),
    );
    expect(webhookOutcome.recordings).toEqual([
      {
        action: "labeled",
        event: "issues",
        outcome: "authorized",
      },
    ]);
  });
});

describe("authorized GitHub issue activation route", () => {
  function activationPayload(input: {
    action: string;
    issue?: Record<string, unknown>;
    label?: Record<string, unknown> | null;
    milestone?: Record<string, unknown> | null;
  }) {
    return {
      action: input.action,
      installation: { id: 124_001 },
      issue: {
        body: "hostile model-readable issue content must remain outside run construction",
        labels: [{ name: "agent-ready" }, { name: "area:github" }, { name: "priority:p0" }],
        milestone: { id: 31, title: "M5 Security" },
        number: 256,
        state: "open",
        title: "Authorize exact issue activation",
        ...input.issue,
      },
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.milestone === undefined ? {} : { milestone: input.milestone }),
      repository: { full_name: "ncolesummers/loopworks", id: 81_000_001 },
      sender: { id: 90_000_001, login: "outside-contributor" },
    };
  }

  function signedRequest(deliveryId: string, rawPayload: Record<string, unknown>) {
    const body = JSON.stringify(rawPayload);
    return new Request("https://loopworks.local/api/github/webhooks", {
      body,
      headers: {
        "x-github-delivery": deliveryId,
        "x-github-event": "issues",
        "x-hub-signature-256": createGithubWebhookSignature("activation-secret", body),
      },
      method: "POST",
    });
  }

  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "activation-secret");
  });

  it("bounds unsupported action evidence in the durable ignored audit", async () => {
    const complete = vi.fn();
    const oversizedAction = "x".repeat(65);
    const response = await handleGithubWebhookPost(
      signedRequest(
        "oversized-action-delivery",
        activationPayload({ action: oversizedAction, label: null }),
      ),
      {
        webhookDeliveryStore: { claim: vi.fn(() => true), complete },
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      authorization: { action: "unsupported", outcome: "ignored" },
    });
    expect(JSON.stringify(complete.mock.calls)).not.toContain(oversizedAction);
  });

  it.each([
    ["opened", { label: null }],
    ["reopened", { label: null }],
    ["edited", { label: null }],
  ])("does not construct a run for an unauthorized %s delivery", async (action, overrides) => {
    const resolvePermission = vi.fn(async () => ({
      decision: "unauthorized" as const,
      permission: "read",
      roleName: "read",
    }));
    const response = await handleGithubWebhookPost(
      signedRequest(`unauthorized-${action}-delivery`, activationPayload({ action, ...overrides })),
      {
        resolveIssueActivationPermission: resolvePermission,
        resolveTrackedRepositoryBinding: vi.fn(async () => ({
          decision: "bound" as const,
          installationId: 124_001,
          owner: "ncolesummers",
          repo: "loopworks",
          repositoryId: 81_000_001,
        })),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      } as Parameters<typeof handleGithubWebhookPost>[1],
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: true,
      authorization: { outcome: action === "edited" ? "ignored" : "unauthorized" },
      nextAction: "record_and_ignore",
    });
    expect(body).not.toHaveProperty("developmentRun");
    expect(body).not.toHaveProperty("researchRun");
    if (action === "edited") expect(resolvePermission).not.toHaveBeenCalled();
  });

  it.each([
    ["unrelated label", { label: { name: "area:github" } }],
    ["missing changed label", { label: null }],
    ["mismatched changed label", { label: { name: "agent-ready" }, issue: { labels: [] } }],
  ])("ignores %s without permission lookup or run construction", async (_name, overrides) => {
    const resolvePermission = vi.fn();
    const response = await handleGithubWebhookPost(
      signedRequest(
        `ignored-${_name.replaceAll(" ", "-")}-delivery`,
        activationPayload({ action: "labeled", ...overrides }),
      ),
      {
        resolveIssueActivationPermission: resolvePermission,
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      } as Parameters<typeof handleGithubWebhookPost>[1],
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: true,
      authorization: { outcome: "ignored" },
      nextAction: "record_and_ignore",
    });
    expect(body).not.toHaveProperty("developmentRun");
    expect(resolvePermission).not.toHaveBeenCalled();
  });

  it.each([
    ["labeled", { label: { name: "agent-ready" } }],
    ["milestoned", { milestone: { id: 31, title: "M5 Security" } }],
  ])("constructs one run only after authorized final %s readiness", async (action, overrides) => {
    const resolvePermission = vi.fn(async () => ({
      decision: "authorized" as const,
      permission: "read",
      roleName: "triage",
    }));
    const response = await handleGithubWebhookPost(
      signedRequest(`authorized-${action}-delivery`, activationPayload({ action, ...overrides })),
      {
        resolveIssueActivationPermission: resolvePermission,
        resolveTrackedRepositoryBinding: vi.fn(async () => ({
          decision: "bound" as const,
          installationId: 124_001,
          owner: "ncolesummers",
          repo: "loopworks",
          repositoryId: 81_000_001,
        })),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      } as Parameters<typeof handleGithubWebhookPost>[1],
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      authorization: { outcome: "authorized" },
      developmentRun: { mode: "simulated" },
      nextAction: "queue_planning_agent",
    });
    expect(resolvePermission).toHaveBeenCalledTimes(1);
  });

  it("returns 503 and leaves no run when permission resolution is indeterminate", async () => {
    const store = createInMemoryGithubWebhookDeliveryStore();
    const response = await handleGithubWebhookPost(
      signedRequest(
        "indeterminate-permission-delivery",
        activationPayload({ action: "labeled", label: { name: "agent-ready" } }),
      ),
      {
        resolveIssueActivationPermission: vi.fn(async () => ({
          decision: "indeterminate" as const,
          reason: "github_permission_unavailable",
        })),
        resolveTrackedRepositoryBinding: vi.fn(async () => ({
          decision: "bound" as const,
          installationId: 124_001,
          owner: "ncolesummers",
          repo: "loopworks",
          repositoryId: 81_000_001,
        })),
        webhookDeliveryStore: store,
      } as Parameters<typeof handleGithubWebhookPost>[1],
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: false,
      authorization: { outcome: "indeterminate" },
      retryable: true,
    });
    expect(body).not.toHaveProperty("developmentRun");
  });

  it("fails closed as manifest drift when an injected manifest declares no evaluator", async () => {
    const permission = vi.fn();
    const development = defaultLoopManifest.loops.find((loop) => loop.key === "development-loop");
    if (!development) throw new Error("missing development-loop manifest");
    const response = await handleGithubWebhookPost(
      signedRequest(
        "declared-action-drift-delivery",
        activationPayload({ action: "edited", label: null }),
      ),
      {
        issueActivationManifests: [
          {
            ...development,
            triggers: { ...development.triggers, issueStates: ["edited"] },
          },
        ],
        resolveIssueActivationPermission: permission,
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      authorization: {
        outcome: "manifest_drift",
        reason: "missing_transition_evaluator",
      },
      nextAction: "record_and_ignore",
    });
    expect(permission).not.toHaveBeenCalled();
  });

  it("returns retryable indeterminate before permission lookup on immutable binding mismatch", async () => {
    const permission = vi.fn();
    const response = await handleGithubWebhookPost(
      signedRequest(
        "binding-mismatch-delivery",
        activationPayload({ action: "labeled", label: { name: "agent-ready" } }),
      ),
      {
        resolveIssueActivationPermission: permission,
        resolveTrackedRepositoryBinding: vi.fn(async () => ({
          decision: "indeterminate" as const,
          reason: "repository_binding_missing_or_mismatched" as const,
        })),
        webhookDeliveryStore: createInMemoryGithubWebhookDeliveryStore(),
      },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      authorization: { outcome: "indeterminate" },
      retryable: true,
    });
    expect(permission).not.toHaveBeenCalled();
  });
});
