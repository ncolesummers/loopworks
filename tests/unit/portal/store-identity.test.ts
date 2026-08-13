/** @vitest-environment node */

import { createHash } from "node:crypto";

import { storeIdentity } from "@/db/schema";
import {
  provisionStoreIdentity,
  readStoreIdentity,
  type StoreIdentityProvisionDatabase,
  verifyStoreIdentity,
} from "@/lib/portal/store-identity";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

/**
 * The four states a production read must be able to tell apart (#158). Row counts
 * cannot produce any of them: a reachable wrong database and a fresh install both
 * answer successfully with zero rows, which is the silent failure ADR 0019 left
 * out of scope.
 */
describe("store identity verification (pglite integration)", () => {
  let context: PgliteTestDatabase;

  const expectedStoreId = "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f";
  const otherStoreId = "018f7c2e-0000-7c3d-9e4f-2a6b8c0d1e2f";

  // Computed independently of the implementation so a change to the digest
  // function fails here rather than being confirmed by its own helper.
  function digestOf(value: string): string {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
  }

  // PGlite's insert builder carries a driver-specific result type, so the handle
  // needs the same cast the seed suites use for `SeedDatabase`.
  function storeDatabase(): StoreIdentityProvisionDatabase {
    return context.db as unknown as StoreIdentityProvisionDatabase;
  }

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  /**
   * The load-bearing half of migration 0003 is its hand-added `INSERT`, which is
   * the only source of a real install's identity — every other test in this file
   * truncates it away in `beforeEach` and re-inserts by hand, so deleting that
   * line from the migration would leave them all green. This one reads a freshly
   * migrated database before any reset.
   */
  it(
    "is provisioned by the migration on a newly created database",
    async () => {
      const migrated = await createPgliteTestDatabase();

      try {
        const storeId = await readStoreIdentity(
          migrated.db as unknown as StoreIdentityProvisionDatabase,
        );

        expect(storeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      } finally {
        await migrated.close();
      }
    },
    pgliteTestHookTimeoutMs,
  );

  /**
   * A database that never ran this migration is a different database, or one whose
   * schema predates the identity contract — the most likely real instance of #158.
   * Left to the generic read failure it would be reported as an outage, which is
   * the wrong diagnosis.
   */
  it("reports an unreadable store when the identity table does not exist", async () => {
    await context.client.exec('DROP TABLE "store_identity"');

    try {
      await expect(
        verifyStoreIdentity({
          database: storeDatabase(),
          env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
        }),
      ).resolves.toEqual({
        expectedDigest: digestOf(expectedStoreId),
        status: "unreadable",
      });
    } finally {
      // `reset` truncates the tables it discovered at creation, so the dropped
      // table has to come back before the next test resets.
      await context.client.exec(
        'CREATE TABLE "store_identity" ("id" integer PRIMARY KEY DEFAULT 1 NOT NULL, "store_id" uuid DEFAULT gen_random_uuid() NOT NULL, "provisioned_at" timestamp with time zone DEFAULT now() NOT NULL, CONSTRAINT "store_identity_single_row" CHECK ("store_identity"."id" = 1))',
      );
    }
  });

  it("does not swallow a read failure that is not a missing table", async () => {
    const failingDatabase = {
      select: () => {
        throw new Error("connection terminated");
      },
    } as unknown as StoreIdentityProvisionDatabase;

    await expect(
      verifyStoreIdentity({
        database: failingDatabase,
        env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
      }),
    ).rejects.toThrow("connection terminated");
  });

  /**
   * `.env.example` ships a real, schema-valid uuid. Copied into a deployment it
   * would otherwise read as a permanent wrong-database verdict rather than as the
   * missing configuration it is.
   */
  it("treats the generated example identifier as unconfigured", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: "00000000-0000-0000-0000-000000000000" },
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("verifies a provisioned store whose recorded id matches the expected id", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
      }),
    ).resolves.toEqual({ status: "verified" });
  });

  it("reports a mismatch when a reachable store carries a different identity", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: otherStoreId });

    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
      }),
    ).resolves.toEqual({
      actualDigest: digestOf(otherStoreId),
      expectedDigest: digestOf(expectedStoreId),
      status: "mismatch",
    });
  });

  /**
   * The repro in #158: the documented reset truncates every public table, so the
   * identity row goes with it. A provisioned store that was emptied is therefore
   * distinguishable from one that still holds its identity.
   */
  it("reports an unprovisioned store when the identity row was truncated away", async () => {
    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
      }),
    ).resolves.toEqual({
      expectedDigest: digestOf(expectedStoreId),
      status: "unprovisioned",
    });
  });

  /**
   * Postgres normalizes `uuid` to lowercase on read, but operators copy identifiers
   * from tools that print them uppercase. A raw string compare would call the
   * correct database the wrong one and take production down with it.
   */
  it("verifies an expected id that differs from the stored one only in case", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId.toUpperCase() },
      }),
    ).resolves.toEqual({ status: "verified" });
  });

  it("reports not_configured when no expected id is supplied", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(verifyStoreIdentity({ database: storeDatabase(), env: {} })).resolves.toEqual({
      status: "not_configured",
    });
  });

  it("treats a blank expected id as unconfigured rather than as a value to match", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(
      verifyStoreIdentity({
        database: storeDatabase(),
        env: { LOOPWORKS_EXPECTED_STORE_ID: "   " },
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("keeps the first provisioned identity and reports it, so a re-run cannot reissue it", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId });

    await expect(
      provisionStoreIdentity({ database: storeDatabase(), storeId: otherStoreId }),
    ).resolves.toEqual({ provisioned: false, storeId: expectedStoreId });

    const rows = await context.db.select().from(storeIdentity);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storeId).toBe(expectedStoreId);
  });

  it("reports that it provisioned the identity on a store that had none", async () => {
    await expect(
      provisionStoreIdentity({ database: storeDatabase(), storeId: expectedStoreId }),
    ).resolves.toEqual({ provisioned: true, storeId: expectedStoreId });
  });

  /**
   * The verification result reaches structured logs, so it must not carry the raw
   * identifiers of either the expected store or the one that answered.
   */
  it("exposes only digests, never the raw store identifiers", async () => {
    await provisionStoreIdentity({ database: storeDatabase(), storeId: otherStoreId });

    const result = await verifyStoreIdentity({
      database: storeDatabase(),
      env: { LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId },
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(expectedStoreId);
    expect(serialized).not.toContain(otherStoreId);
  });
});
