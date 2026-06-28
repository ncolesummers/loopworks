import { claimGithubWebhookDelivery } from "@/lib/github/webhooks";
import {
  createDrizzleGithubWebhookDeliveryStore,
  type GithubWebhookDatabase,
} from "@/lib/github/webhook-store";
import { idempotencyLocks, webhookDeliveries } from "@/db/schema";

function createFakeWebhookDatabase() {
  const locks: Record<string, unknown>[] = [];
  const deliveries: Record<string, unknown>[] = [];

  const transaction = async <T>(callback: (tx: unknown) => Promise<T> | T): Promise<T> => {
    const tx = {
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
              where: async () => {
                const rows =
                  table === idempotencyLocks
                    ? locks
                    : table === webhookDeliveries
                      ? deliveries
                      : null;

                if (!rows) {
                  throw new Error("Unexpected update table.");
                }

                for (const row of rows) {
                  Object.assign(row, value);
                }
              },
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
    const store = createDrizzleGithubWebhookDeliveryStore(fake.database);

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

    await store.complete?.(claim.key, {
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
});
