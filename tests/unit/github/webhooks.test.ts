import {
  canUseInMemoryGithubWebhookDeliveryStore,
  claimGithubWebhookDelivery,
  createGithubWebhookSignature,
  createInMemoryGithubWebhookDeliveryStore,
  evaluateGithubIssueReadiness,
  getAgentReadyTriggerFromIssuesWebhook,
  verifyGithubWebhookSignature,
} from "@/lib/github/webhooks";

describe("GitHub webhook helpers", () => {
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
});
