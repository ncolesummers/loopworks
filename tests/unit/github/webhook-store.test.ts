import { idempotencyLocks, webhookDeliveries } from "@/db/schema";
import {
  createDrizzleGithubWebhookDeliveryStore,
  type GithubWebhookDatabase,
} from "@/lib/github/webhook-store";
import { claimGithubWebhookDelivery } from "@/lib/github/webhooks";

function createFakeWebhookDatabase() {
  const locks: Record<string, unknown>[] = [];
  const deliveries: Record<string, unknown>[] = [];

  const transaction = async <T>(callback: (tx: unknown) => Promise<T> | T): Promise<T> => {
    const tx = {
      select() {
        return {
          from(table: unknown) {
            return {
              where() {
                return {
                  limit: async () => {
                    if (table !== webhookDeliveries) {
                      throw new Error("Unexpected select table.");
                    }

                    return deliveries
                      .filter(
                        (delivery) =>
                          delivery.status === "failed" || delivery.status === "received",
                      )
                      .slice(0, 1);
                  },
                };
              },
            };
          },
        };
      },
      insert(table: unknown) {
        return {
          values(value: Record<string, unknown>) {
            return {
              onConflictDoNothing() {
                return {
                  returning: async () => {
                    if (table === idempotencyLocks) {
                      if (locks.some((lock) => lock.key === value.key)) {
                        return [];
                      }

                      locks.push({ ...value });
                      return [{ id: "lock-1" }];
                    }

                    if (table === webhookDeliveries) {
                      if (deliveries.some((delivery) => delivery.deliveryId === value.deliveryId)) {
                        return [];
                      }

                      deliveries.push({ ...value });
                      return [{ id: "delivery-1" }];
                    }

                    throw new Error("Unexpected insert table.");
                  },
                };
              },
            };
          },
        };
      },
      update(table: unknown) {
        return {
          set(value: Record<string, unknown>) {
            return {
              where: () => ({
                returning: async () => {
                  const rows =
                    table === idempotencyLocks
                      ? locks
                      : table === webhookDeliveries
                        ? deliveries
                        : null;

                  if (!rows) {
                    throw new Error("Unexpected update table.");
                  }

                  const updatedRows =
                    table === idempotencyLocks
                      ? rows.filter((row) => {
                          if (value.status === "acquired") {
                            return row.status === "released" || row.status === "expired";
                          }

                          return true;
                        })
                      : rows.filter((row) => {
                          if (value.status === "received") {
                            return row.status === "failed" || row.status === "received";
                          }

                          return true;
                        });

                  for (const row of updatedRows) {
                    Object.assign(row, value);
                  }
                  return updatedRows.map((_, index) => ({ id: `updated-${index}` }));
                },
              }),
            };
          },
        };
      },
    };

    return callback(tx);
  };

  return {
    database: { transaction } as unknown as GithubWebhookDatabase,
    deliveries,
    locks,
  };
}

describe("Drizzle GitHub webhook delivery store", () => {
  it("claims a GitHub delivery once and records the idempotency lock plus delivery row", async () => {
    const fake = createFakeWebhookDatabase();
    const lockContentionScopes: string[] = [];
    const store = createDrizzleGithubWebhookDeliveryStore(fake.database, {
      recordLockContentionMetric(input) {
        lockContentionScopes.push(input.scope);
      },
    });

    const first = await claimGithubWebhookDelivery({
      store,
      deliveryId: " Delivery-1 ",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      payload: {
        issueNumber: 7,
        labels: ["agent-ready"],
      },
      receivedAt: new Date("2026-06-28T01:00:00.000Z"),
    });
    const second = await claimGithubWebhookDelivery({
      store,
      deliveryId: "delivery-1",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:01.000Z"),
    });

    expect(first).toEqual({
      accepted: true,
      deliveryId: "delivery-1",
      key: "github:delivery-1",
    });
    expect(second).toMatchObject({
      accepted: false,
      deliveryId: "delivery-1",
      key: "github:delivery-1",
    });
    expect(fake.locks).toEqual([
      expect.objectContaining({
        key: "github:delivery-1",
        scope: "github:webhook-delivery",
        owner: "delivery-1",
        status: "acquired",
      }),
    ]);
    expect(fake.deliveries).toEqual([
      expect.objectContaining({
        action: "labeled",
        deliveryId: "delivery-1",
        event: "issues",
        payload: {
          issueNumber: 7,
          labels: ["agent-ready"],
        },
        repositoryFullName: "ncolesummers/loopworks",
        source: "github",
        status: "received",
      }),
    ]);
    expect(lockContentionScopes).toEqual(["github:webhook-delivery"]);
  });

  it.each([
    "processed",
    "ignored",
    "failed",
  ] as const)("records a %s delivery outcome and releases the lock", async (status) => {
    const fake = createFakeWebhookDatabase();
    const store = createDrizzleGithubWebhookDeliveryStore(fake.database);
    const claim = await claimGithubWebhookDelivery({
      store,
      deliveryId: `${status}-delivery`,
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:00.000Z"),
    });

    await store.complete(claim.key, {
      deliveryId: claim.deliveryId,
      metadata: {
        triggerWorkflow: status === "processed" ? "development" : "none",
      },
      processedAt: "2026-06-28T01:00:02.000Z",
      status,
    });

    expect(fake.deliveries).toEqual([
      expect.objectContaining({
        deliveryId: `${status}-delivery`,
        processedAt: new Date("2026-06-28T01:00:02.000Z"),
        status,
      }),
    ]);
    expect(fake.locks).toEqual([
      expect.objectContaining({
        key: `github:${status}-delivery`,
        metadata: {
          deliveryStatus: status,
          triggerWorkflow: status === "processed" ? "development" : "none",
        },
        releasedAt: new Date("2026-06-28T01:00:02.000Z"),
        status: "released",
      }),
    ]);
  });

  it("allows a failed GitHub delivery to be claimed again for manual redelivery", async () => {
    const fake = createFakeWebhookDatabase();
    const store = createDrizzleGithubWebhookDeliveryStore(fake.database);
    const firstClaim = await claimGithubWebhookDelivery({
      store,
      deliveryId: "retryable-delivery",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:00.000Z"),
    });

    await store.complete(firstClaim.key, {
      deliveryId: firstClaim.deliveryId,
      metadata: {
        failureType: "Error",
      },
      processedAt: "2026-06-28T01:00:02.000Z",
      status: "failed",
    });

    const secondClaim = await claimGithubWebhookDelivery({
      store,
      deliveryId: "retryable-delivery",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:05.000Z"),
    });

    expect(secondClaim).toEqual({
      accepted: true,
      deliveryId: "retryable-delivery",
      key: "github:retryable-delivery",
    });
    expect(fake.deliveries).toHaveLength(1);
    expect(fake.deliveries).toEqual([
      expect.objectContaining({
        deliveryId: "retryable-delivery",
        processedAt: null,
        status: "received",
      }),
    ]);
    expect(fake.locks).toEqual([
      expect.objectContaining({
        key: "github:retryable-delivery",
        releasedAt: null,
        status: "acquired",
      }),
    ]);
  });

  it("does not rewrite processed delivery lock evidence on duplicate redelivery", async () => {
    const fake = createFakeWebhookDatabase();
    const lockContentionScopes: string[] = [];
    const store = createDrizzleGithubWebhookDeliveryStore(fake.database, {
      recordLockContentionMetric(input) {
        lockContentionScopes.push(input.scope);
      },
    });
    const firstClaim = await claimGithubWebhookDelivery({
      store,
      deliveryId: "processed-duplicate-delivery",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:00.000Z"),
    });

    await store.complete(firstClaim.key, {
      deliveryId: firstClaim.deliveryId,
      metadata: {
        nextAction: "queue_planning_agent",
        triggerWorkflow: "development",
      },
      processedAt: "2026-06-28T01:00:02.000Z",
      status: "processed",
    });

    const duplicateClaim = await claimGithubWebhookDelivery({
      store,
      deliveryId: "processed-duplicate-delivery",
      event: "issues",
      action: "labeled",
      repositoryFullName: "ncolesummers/loopworks",
      receivedAt: new Date("2026-06-28T01:00:05.000Z"),
    });

    expect(duplicateClaim).toMatchObject({
      accepted: false,
      deliveryId: "processed-duplicate-delivery",
      key: "github:processed-duplicate-delivery",
    });
    expect(fake.deliveries).toEqual([
      expect.objectContaining({
        deliveryId: "processed-duplicate-delivery",
        processedAt: new Date("2026-06-28T01:00:02.000Z"),
        status: "processed",
      }),
    ]);
    expect(fake.locks).toEqual([
      expect.objectContaining({
        key: "github:processed-duplicate-delivery",
        metadata: {
          deliveryStatus: "processed",
          nextAction: "queue_planning_agent",
          triggerWorkflow: "development",
        },
        releasedAt: new Date("2026-06-28T01:00:02.000Z"),
        status: "released",
      }),
    ]);
    expect(lockContentionScopes).toEqual(["github:webhook-delivery"]);
  });
});
