/** @vitest-environment node */
import { eq } from "drizzle-orm";

import { handleGithubWebhookPost } from "@/app/api/github/webhooks/route";
import {
  agentPlans,
  artifacts,
  idempotencyLocks,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
  webhookDeliveries,
} from "@/db/schema";
import {
  createDrizzleGithubWebhookDeliveryStore,
  type GithubWebhookDatabase,
} from "@/lib/github/webhook-store";
import type { DevelopmentLoopRunDatabase } from "@/lib/loops/development-run";

import { createGithubWebhookFixture } from "../../../scripts/github-webhook-fixture";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const lockTtlMs = 5 * 60 * 1000;

describe("GitHub webhook delivery store (pglite integration)", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await context.close();
  });

  function createStore() {
    return createDrizzleGithubWebhookDeliveryStore(context.db as unknown as GithubWebhookDatabase, {
      lockTtlMs,
    });
  }

  async function insertLoopworksRepository() {
    await context.db.insert(repositories).values({
      githubRepoId: 11_000_001,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
      enabledLoops: ["Agent-ready development loop"],
      validationGates: ["Focused tests", "Aggregate validation"],
    });
  }

  it("claims once, rejects an in-flight duplicate, then completes and blocks reprocessing", async () => {
    const store = createStore();
    const key = "github:lifecycle-delivery";
    const deliveryId = "lifecycle-delivery";
    const receivedAt = "2026-06-28T00:00:00.000Z";
    const processedAt = "2026-06-28T00:05:00.000Z";

    const first = await store.claim(key, {
      deliveryId,
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      payload: { event: "issues", issueNumber: 42 },
      receivedAt,
    });
    expect(first).toBe(true);

    const deliveries = await context.db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      deliveryId,
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      source: "github",
      status: "received",
      payload: { event: "issues", issueNumber: 42 },
    });
    expect(deliveries[0].receivedAt).toEqual(new Date(receivedAt));
    expect(deliveries[0].processedAt).toBeNull();

    const locks = await context.db.select().from(idempotencyLocks);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({
      key,
      owner: deliveryId,
      scope: "github:webhook-delivery",
      status: "acquired",
      metadata: {
        event: "issues",
        action: "labeled",
        repositoryFullName: "ncolesummers/loopworks",
      },
    });
    expect(locks[0].expiresAt).toEqual(new Date(new Date(receivedAt).getTime() + lockTtlMs));
    expect(locks[0].releasedAt).toBeNull();

    // A duplicate arriving while the lock is still held is rejected, with no new rows.
    const duplicate = await store.claim(key, { deliveryId, event: "issues", receivedAt });
    expect(duplicate).toBe(false);
    expect(await context.db.select().from(webhookDeliveries)).toHaveLength(1);
    expect(await context.db.select().from(idempotencyLocks)).toHaveLength(1);

    await store.complete(key, {
      deliveryId,
      metadata: { nextAction: "queue_planning_agent", triggerWorkflow: "development" },
      processedAt,
      status: "processed",
    });

    const [completedDelivery] = await context.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(completedDelivery.status).toBe("processed");
    expect(completedDelivery.processedAt).toEqual(new Date(processedAt));

    const [releasedLock] = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.key, key));
    expect(releasedLock.status).toBe("released");
    expect(releasedLock.releasedAt).toEqual(new Date(processedAt));
    expect(releasedLock.metadata).toMatchObject({
      nextAction: "queue_planning_agent",
      triggerWorkflow: "development",
      deliveryStatus: "processed",
    });

    // A processed delivery is non-retryable: a later replay is rejected with no state change.
    const reprocess = await store.claim(key, {
      deliveryId,
      event: "issues",
      receivedAt: processedAt,
    });
    expect(reprocess).toBe(false);
    const [unchanged] = await context.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(unchanged.status).toBe("processed");
  });

  it("re-claims a failed delivery and resets its persisted state", async () => {
    const store = createStore();
    const key = "github:reclaim-delivery";
    const deliveryId = "reclaim-delivery";
    const receivedAt = "2026-06-28T00:00:00.000Z";
    const failedAt = "2026-06-28T00:01:00.000Z";
    const reclaimedAt = "2026-06-28T00:02:00.000Z";

    const first = await store.claim(key, { deliveryId, event: "issues", receivedAt });
    expect(first).toBe(true);

    await store.complete(key, { deliveryId, processedAt: failedAt, status: "failed" });

    const reclaimed = await store.claim(key, {
      deliveryId,
      event: "issues",
      receivedAt: reclaimedAt,
    });
    expect(reclaimed).toBe(true);

    const [delivery] = await context.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(delivery.status).toBe("received");
    expect(delivery.processedAt).toBeNull();

    const [lock] = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.key, key));
    expect(lock.status).toBe("acquired");
    expect(lock.releasedAt).toBeNull();
    expect(lock.acquiredAt).toEqual(new Date(reclaimedAt));
  });

  it("honors the delivery unique constraint via onConflictDoNothing without raising", async () => {
    const store = createStore();
    const key = "github:conflict-delivery";
    const deliveryId = "conflict-delivery";
    const receivedAt = "2026-06-28T00:00:00.000Z";

    // A processed delivery exists with no matching lock, so the store's lock insert
    // succeeds but the delivery insert must hit the unique conflict target.
    await context.db.insert(webhookDeliveries).values({
      deliveryId,
      event: "issues",
      source: "github",
      status: "processed",
      receivedAt: new Date(receivedAt),
      processedAt: new Date(receivedAt),
    });

    const claimed = await store.claim(key, { deliveryId, event: "issues", receivedAt });
    expect(claimed).toBe(false);

    // No duplicate delivery row, and the existing processed row is untouched.
    const deliveries = await context.db.select().from(webhookDeliveries);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe("processed");

    // The lock created during the rejected claim is released and marked as a duplicate.
    const [lock] = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.key, key));
    expect(lock.status).toBe("released");
    expect(lock.metadata).toMatchObject({ deliveryStatus: "duplicate" });
  });

  it("rolls back the lock insert when the delivery insert fails mid-transaction", async () => {
    const db = context.db;
    const faultyDatabase = {
      transaction(callback: (tx: unknown) => Promise<unknown>) {
        return db.transaction((tx) => {
          const proxy = new Proxy(tx as object, {
            get(target, property, receiver) {
              if (property === "insert") {
                return (table: unknown) => {
                  if (table === webhookDeliveries) {
                    throw new Error("delivery insert boom");
                  }

                  return (target as { insert: (value: unknown) => unknown }).insert(table);
                };
              }

              return Reflect.get(target, property, receiver);
            },
          });

          return callback(proxy);
        });
      },
    } as unknown as GithubWebhookDatabase;

    const store = createDrizzleGithubWebhookDeliveryStore(faultyDatabase, { lockTtlMs });

    await expect(
      store.claim("github:rollback-delivery", {
        deliveryId: "rollback-delivery",
        event: "issues",
        receivedAt: "2026-06-28T00:00:00.000Z",
      }),
    ).rejects.toThrow("delivery insert boom");

    // The lock insert that succeeded before the fault must have rolled back atomically.
    expect(await db.select().from(idempotencyLocks)).toHaveLength(0);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);
  });

  it("persists route-boundary state for an accepted delivery and rejects replays", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    await insertLoopworksRepository();
    const store = createStore();
    const fixture = createGithubWebhookFixture({
      deliveryId: "fixture-route-persistence-delivery",
      kind: "agent-ready",
      secret: "dev-webhook-secret",
      url: "https://loopworks.local/api/github/webhooks",
    });
    const now = () => new Date("2026-06-28T02:00:00.000Z");
    const makeRequest = () =>
      new Request(fixture.url, {
        body: fixture.payloadText,
        headers: fixture.headers,
        method: "POST",
      });

    const first = await handleGithubWebhookPost(makeRequest(), {
      developmentRunDatabase: context.db as unknown as DevelopmentLoopRunDatabase,
      now,
      webhookDeliveryStore: store,
    });
    expect(first.status).toBe(202);
    await expect(first.json()).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      agentReadyTrigger: { shouldTrigger: true, workflow: "development" },
      developmentRun: {
        artifactCount: 8,
        mode: "created",
        stageCount: 8,
      },
      nextAction: "queue_planning_agent",
    });

    const [delivery] = await context.db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, fixture.deliveryId));
    expect(delivery.event).toBe("issues");
    expect(delivery.status).toBe("processed");
    expect(delivery.processedAt).toEqual(now());

    const [lock] = await context.db
      .select()
      .from(idempotencyLocks)
      .where(eq(idempotencyLocks.key, `github:${fixture.deliveryId}`));
    expect(lock.status).toBe("released");
    expect(lock.metadata).toMatchObject({
      nextAction: "queue_planning_agent",
      triggerWorkflow: "development",
      deliveryStatus: "processed",
    });

    const runRows = await context.db.select().from(loopRuns);
    const stepRows = await context.db.select().from(runSteps);
    const artifactRows = await context.db.select().from(artifacts);
    const planRows = await context.db.select().from(agentPlans);
    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      githubIssueNumber: 11,
      loopKey: "development-loop",
      status: "queued",
    });
    expect(stepRows).toHaveLength(8);
    expect(artifactRows).toHaveLength(8);
    expect(planRows).toHaveLength(1);

    // A replayed delivery is rejected at the route boundary without creating new rows.
    const second = await handleGithubWebhookPost(makeRequest(), {
      developmentRunDatabase: context.db as unknown as DevelopmentLoopRunDatabase,
      now,
      webhookDeliveryStore: store,
    });
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toMatchObject({
      accepted: false,
      duplicate: true,
    });
    expect(await context.db.select().from(webhookDeliveries)).toHaveLength(1);
    expect(await context.db.select().from(idempotencyLocks)).toHaveLength(1);
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
    expect(await context.db.select().from(runSteps)).toHaveLength(8);
    expect(await context.db.select().from(artifacts)).toHaveLength(8);
    expect(await context.db.select().from(agentPlans)).toHaveLength(1);
  });

  it("persists disabled-loop no-op state at the route boundary", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    vi.stubEnv("LOOPWORKS_DEVELOPMENT_LOOP_ENABLED", "false");
    await insertLoopworksRepository();
    const store = createStore();
    const fixture = createGithubWebhookFixture({
      deliveryId: "fixture-route-noop-delivery",
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
        developmentRunDatabase: context.db as unknown as DevelopmentLoopRunDatabase,
        now: () => new Date("2026-06-28T02:05:00.000Z"),
        webhookDeliveryStore: store,
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      agentReadyTrigger: {
        reason: "loop_disabled",
        shouldTrigger: false,
        skipped: true,
        workflow: "development",
      },
      developmentRun: {
        mode: "noop",
        reason: "loop_disabled",
      },
    });
    expect(await context.db.select().from(loopRuns)).toHaveLength(0);
    expect(
      await context.db
        .select()
        .from(observabilityEvents)
        .where(eq(observabilityEvents.eventType, "development_loop_noop")),
    ).toHaveLength(1);
  });

  it("does not persist a development no-op for disabled research loops", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "dev-webhook-secret");
    vi.stubEnv("LOOPWORKS_RESEARCH_LOOP_ENABLED", "false");
    await insertLoopworksRepository();
    const store = createStore();
    const fixture = createGithubWebhookFixture({
      deliveryId: "fixture-route-research-noop-delivery",
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
        developmentRunDatabase: context.db as unknown as DevelopmentLoopRunDatabase,
        now: () => new Date("2026-06-28T02:06:00.000Z"),
        webhookDeliveryStore: store,
      },
    );

    expect(response.status).toBe(202);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      accepted: true,
      agentReadyTrigger: {
        reason: "loop_disabled",
        shouldTrigger: false,
        skipped: true,
        workflow: "research",
      },
    });
    expect(responseBody).not.toHaveProperty("developmentRun");
    expect(await context.db.select().from(loopRuns)).toHaveLength(0);
    expect(
      await context.db
        .select()
        .from(observabilityEvents)
        .where(eq(observabilityEvents.eventType, "development_loop_noop")),
    ).toHaveLength(0);
  });
});
