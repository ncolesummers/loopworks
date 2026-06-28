import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { idempotencyLocks, webhookDeliveries } from "@/db/schema";
import type { GithubWebhookDeliveryStore } from "@/lib/github/webhooks";

type InsertReturningBuilder = {
  returning: (selection: Record<string, unknown>) => Promise<unknown[]>;
};

type InsertConflictBuilder = {
  onConflictDoNothing: (config: { target: unknown }) => InsertReturningBuilder;
};

type InsertValuesBuilder = {
  values: (value: Record<string, unknown>) => InsertConflictBuilder;
};

type UpdateWhereBuilder = {
  where: (condition: unknown) => Promise<unknown>;
};

type UpdateSetBuilder = {
  set: (value: Record<string, unknown>) => UpdateWhereBuilder;
};

type GithubWebhookTransaction = {
  insert: (table: unknown) => InsertValuesBuilder;
  update: (table: unknown) => UpdateSetBuilder;
};

export type GithubWebhookDatabase = {
  transaction: <T>(callback: (tx: GithubWebhookTransaction) => Promise<T> | T) => Promise<T>;
};

const defaultLockTtlMs = 5 * 60 * 1000;
const webhookDeliveryScope = "github:webhook-delivery";

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid GitHub webhook timestamp: ${value}`);
  }

  return parsed;
}

function buildLockMetadata(record: {
  action?: string;
  event: string;
  repositoryFullName?: string;
}): Record<string, unknown> {
  return {
    ...(record.action ? { action: record.action } : {}),
    event: record.event,
    ...(record.repositoryFullName ? { repositoryFullName: record.repositoryFullName } : {}),
  };
}

export function createDrizzleGithubWebhookDeliveryStore(
  database: GithubWebhookDatabase = db as unknown as GithubWebhookDatabase,
  options: {
    lockTtlMs?: number;
  } = {},
): GithubWebhookDeliveryStore {
  const lockTtlMs = options.lockTtlMs ?? defaultLockTtlMs;

  return {
    async claim(key, record) {
      const receivedAt = parseTimestamp(record.receivedAt);
      const expiresAt = new Date(receivedAt.getTime() + lockTtlMs);

      return database.transaction(async (tx) => {
        const insertedLocks = await tx
          .insert(idempotencyLocks)
          .values({
            expiresAt,
            key,
            metadata: buildLockMetadata(record),
            owner: record.deliveryId,
            scope: webhookDeliveryScope,
            status: "acquired",
          })
          .onConflictDoNothing({ target: idempotencyLocks.key })
          .returning({ id: idempotencyLocks.id });

        if (insertedLocks.length === 0) {
          return false;
        }

        const deliveryRecord = {
          ...(record.action ? { action: record.action } : {}),
          deliveryId: record.deliveryId,
          event: record.event,
          ...(record.payload ? { payload: record.payload } : {}),
          receivedAt,
          ...(record.repositoryFullName ? { repositoryFullName: record.repositoryFullName } : {}),
          source: "github",
          status: "received",
        };

        const insertedDeliveries = await tx
          .insert(webhookDeliveries)
          .values(deliveryRecord)
          .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
          .returning({ id: webhookDeliveries.id });

        if (insertedDeliveries.length === 0) {
          await tx
            .update(idempotencyLocks)
            .set({
              metadata: {
                ...buildLockMetadata(record),
                deliveryStatus: "duplicate",
              },
              releasedAt: receivedAt,
              status: "released",
            })
            .where(eq(idempotencyLocks.key, key));
          return false;
        }

        return true;
      });
    },

    async complete(key, record) {
      const processedAt = parseTimestamp(record.processedAt);

      await database.transaction(async (tx) => {
        await tx
          .update(webhookDeliveries)
          .set({
            processedAt,
            status: record.status,
          })
          .where(eq(webhookDeliveries.deliveryId, record.deliveryId));

        await tx
          .update(idempotencyLocks)
          .set({
            metadata: {
              ...(record.metadata ?? {}),
              deliveryStatus: record.status,
            },
            releasedAt: processedAt,
            status: "released",
          })
          .where(eq(idempotencyLocks.key, key));
      });
    },
  };
}
