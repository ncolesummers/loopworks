import { and, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db/client";
import { idempotencyLocks, webhookDeliveries, type webhookDeliveryStatusEnum } from "@/db/schema";
import type { GithubWebhookDeliveryStore } from "@/lib/github/webhooks";
import {
  type LockContentionMetricInput,
  recordLockContentionMetric,
} from "@/lib/observability/metrics";

export type GithubWebhookDatabase = Pick<typeof db, "transaction">;

type WebhookDeliveryStatus = (typeof webhookDeliveryStatusEnum.enumValues)[number];
type RetryableWebhookDeliveryStatus = Extract<WebhookDeliveryStatus, "failed" | "received">;

const defaultLockTtlMs = 5 * 60 * 1000;
const webhookDeliveryScope = "github:webhook-delivery";
const retryableDeliveryStatuses = ["failed", "received"] satisfies RetryableWebhookDeliveryStatus[];

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

function recordLockContentionSafely(
  recordMetric: (input: LockContentionMetricInput) => void,
): void {
  try {
    recordMetric({
      scope: webhookDeliveryScope,
    });
  } catch {
    // Lock acquisition must not depend on telemetry sink health.
  }
}

async function hasRetryableDelivery(
  tx: Parameters<Parameters<GithubWebhookDatabase["transaction"]>[0]>[0],
  deliveryId: string,
): Promise<boolean> {
  const retryableDeliveries = await tx
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.deliveryId, deliveryId),
        inArray(webhookDeliveries.status, retryableDeliveryStatuses),
      ),
    )
    .limit(1);

  return retryableDeliveries.length > 0;
}

export function createDrizzleGithubWebhookDeliveryStore(
  database: GithubWebhookDatabase = db,
  options: {
    lockTtlMs?: number;
    recordLockContentionMetric?: (input: LockContentionMetricInput) => void;
  } = {},
): GithubWebhookDeliveryStore {
  const lockTtlMs = options.lockTtlMs ?? defaultLockTtlMs;
  const recordLockContention = options.recordLockContentionMetric ?? recordLockContentionMetric;

  return {
    async claim(key, record) {
      const receivedAt = parseTimestamp(record.receivedAt);
      const expiresAt = new Date(receivedAt.getTime() + lockTtlMs);
      const lockRecord = {
        expiresAt,
        key,
        metadata: buildLockMetadata(record),
        owner: record.deliveryId,
        scope: webhookDeliveryScope,
        status: "acquired" as const,
      };
      const deliveryRecord = {
        ...(record.action ? { action: record.action } : {}),
        deliveryId: record.deliveryId,
        event: record.event,
        ...(record.payload ? { payload: record.payload } : {}),
        receivedAt,
        ...(record.repositoryFullName ? { repositoryFullName: record.repositoryFullName } : {}),
        source: "github",
        status: "received" as const,
      };

      return database.transaction(async (tx) => {
        const insertedLocks = await tx
          .insert(idempotencyLocks)
          .values(lockRecord)
          .onConflictDoNothing({ target: idempotencyLocks.key })
          .returning({ id: idempotencyLocks.id });

        if (insertedLocks.length === 0) {
          recordLockContentionSafely(recordLockContention);

          if (!(await hasRetryableDelivery(tx, record.deliveryId))) {
            return false;
          }

          const reclaimedLocks = await tx
            .update(idempotencyLocks)
            .set({
              ...lockRecord,
              acquiredAt: receivedAt,
              releasedAt: null,
            })
            .where(
              and(
                eq(idempotencyLocks.key, key),
                or(
                  eq(idempotencyLocks.status, "released"),
                  eq(idempotencyLocks.status, "expired"),
                  lt(idempotencyLocks.expiresAt, receivedAt),
                ),
              ),
            )
            .returning({ id: idempotencyLocks.id });

          if (reclaimedLocks.length === 0) {
            return false;
          }

          const resetDeliveries = await tx
            .update(webhookDeliveries)
            .set({
              ...deliveryRecord,
              processedAt: null,
            })
            .where(
              and(
                eq(webhookDeliveries.deliveryId, record.deliveryId),
                inArray(webhookDeliveries.status, retryableDeliveryStatuses),
              ),
            )
            .returning({ id: webhookDeliveries.id });

          if (resetDeliveries.length > 0) {
            return true;
          }

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
            .where(eq(idempotencyLocks.key, key))
            .returning({ id: idempotencyLocks.id });
          return false;
        }

        const insertedDeliveries = await tx
          .insert(webhookDeliveries)
          .values(deliveryRecord)
          .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
          .returning({ id: webhookDeliveries.id });

        if (insertedDeliveries.length === 0) {
          recordLockContentionSafely(recordLockContention);

          const resetDeliveries = await tx
            .update(webhookDeliveries)
            .set({
              ...deliveryRecord,
              processedAt: null,
            })
            .where(
              and(
                eq(webhookDeliveries.deliveryId, record.deliveryId),
                inArray(webhookDeliveries.status, retryableDeliveryStatuses),
              ),
            )
            .returning({ id: webhookDeliveries.id });

          if (resetDeliveries.length > 0) {
            return true;
          }

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
            .where(eq(idempotencyLocks.key, key))
            .returning({ id: idempotencyLocks.id });
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
          .where(eq(webhookDeliveries.deliveryId, record.deliveryId))
          .returning({ id: webhookDeliveries.id });

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
          .where(eq(idempotencyLocks.key, key))
          .returning({ id: idempotencyLocks.id });
      });
    },
  };
}
