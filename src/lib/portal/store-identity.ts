import { createHash } from "node:crypto";

import type { db } from "@/db/client";
import { storeIdentity } from "@/db/schema";
import { readSuppliedRawConfig } from "@/lib/config/registry";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { isProductionRuntime } from "@/lib/runtime";

export type StoreIdentityDatabase = Pick<typeof db, "select">;
export type StoreIdentityProvisionDatabase = Pick<typeof db, "insert" | "select">;

/**
 * Why a production read cannot be trusted, or that it can.
 *
 * `mismatch` and `unprovisioned` are separate states because they call for
 * different operator responses: the first means the deployment is pointed at
 * another database, the second means the expected one was emptied. Neither is a
 * new install, which is the confusion this exists to remove (#158).
 */
export type StoreIdentityVerification =
  | { status: "verified" }
  | { actualDigest: string; expectedDigest: string; status: "mismatch" }
  | { expectedDigest: string; status: "unprovisioned" }
  | { expectedDigest: string; status: "unreadable" }
  | { status: "not_configured" };

/** Postgres `undefined_table`. */
const undefinedTableCode = "42P01";

/**
 * True when the store answered but has no `store_identity` table at all.
 *
 * Distinct from an empty table: a database that never ran this migration is a
 * different database, or one whose schema predates the identity contract. Left
 * to the generic read failure it would be reported as an outage, which is the
 * wrong diagnosis for the single most likely instance of #158.
 */
export function isUndefinedTableError(error: unknown): boolean {
  // Drizzle wraps driver errors, so the SQLSTATE lives on `cause`, not on the
  // error it throws. Walking the chain is what makes this match at all; a check
  // against the top-level error alone silently never fires.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === undefinedTableCode) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/**
 * The identifier `.env.example` ships. It is a real uuid and passes schema
 * validation, so a deployment can be handed it by accident; no store will ever
 * report it, which would otherwise present as a permanent wrong-database verdict.
 */
const exampleStoreId = "00000000-0000-0000-0000-000000000000";

export type StoreIdentityProvisionResult = {
  provisioned: boolean;
  storeId: string;
};

/**
 * Canonical form for comparison. Postgres normalizes `uuid` to lowercase on read,
 * while the tools operators copy identifiers from often print them uppercase, and
 * a raw compare would report the correct database as the wrong one.
 */
function canonicalStoreId(storeId: string): string {
  return storeId.trim().toLowerCase();
}

/**
 * A short, stable fingerprint safe to put in a log line. The raw identifiers name
 * the infrastructure a deployment is bound to, and the verification result reaches
 * structured logs, so only digests leave this module. Digests the canonical form,
 * so two spellings of one identity do not read as two different stores.
 */
export function storeIdentityDigest(storeId: string): string {
  return createHash("sha256").update(canonicalStoreId(storeId)).digest("hex").slice(0, 12);
}

/** The identity this store reports, or `undefined` if it has none. */
export async function readStoreIdentity(
  database: StoreIdentityDatabase,
): Promise<string | undefined> {
  const rows = await database.select({ storeId: storeIdentity.storeId }).from(storeIdentity);

  return rows[0]?.storeId;
}

/**
 * Compares the identity the store reports against the one this deployment expects.
 *
 * Reads the supplied value rather than the resolved one: a default would answer
 * for an operator who never set it, and "nobody said which store to expect" has to
 * stay distinguishable from "this is the wrong store".
 */
export async function verifyStoreIdentity(input: {
  database: StoreIdentityDatabase;
  env?: Partial<NodeJS.ProcessEnv>;
}): Promise<StoreIdentityVerification> {
  const suppliedStoreId = readSuppliedRawConfig(
    "LOOPWORKS_EXPECTED_STORE_ID",
    input.env ?? process.env,
  );
  const expectedStoreId = suppliedStoreId ? canonicalStoreId(suppliedStoreId) : "";

  if (!expectedStoreId || expectedStoreId === exampleStoreId) {
    return { status: "not_configured" };
  }

  const expectedDigest = storeIdentityDigest(expectedStoreId);

  let actualStoreId: string | undefined;
  try {
    actualStoreId = await readStoreIdentity(input.database);
  } catch (error) {
    if (!isUndefinedTableError(error)) {
      throw error;
    }

    return { expectedDigest, status: "unreadable" };
  }

  if (actualStoreId === undefined) {
    return { expectedDigest, status: "unprovisioned" };
  }

  if (canonicalStoreId(actualStoreId) !== expectedStoreId) {
    return { actualDigest: storeIdentityDigest(actualStoreId), expectedDigest, status: "mismatch" };
  }

  return { status: "verified" };
}

/**
 * The identity check as a portal read should apply it: returns the failing
 * verification, already logged, or `null` when the read may proceed.
 *
 * Shared so every portal data source gates the same way. `/runs` reads through a
 * different function than the other five surfaces and was originally left
 * unguarded, which rendered "Live runs" over an empty list against a store the
 * rest of the portal was refusing to trust.
 *
 * Scoped to deployments whose store identities are explicitly configured.
 * Development and the fixture and seeded lanes are not production runtimes.
 * The fixed Preview database is configured with its own expected identity, so
 * Preview follows the same fail-closed verification as Production (ADR 0035).
 */
export async function findUnverifiedStoreIdentity(input: {
  database: StoreIdentityDatabase;
  env: Partial<NodeJS.ProcessEnv>;
  logger?: LoopworksLogger;
}): Promise<StoreIdentityVerification | null> {
  if (!isProductionRuntime(input.env)) {
    return null;
  }

  const identity = await verifyStoreIdentity({ database: input.database, env: input.env });
  if (identity.status === "verified") {
    return null;
  }

  input.logger?.warn(
    {
      ...("actualDigest" in identity ? { actualDigest: identity.actualDigest } : {}),
      ...("expectedDigest" in identity ? { expectedDigest: identity.expectedDigest } : {}),
      identityStatus: identity.status,
    },
    "portal_store_identity_unverified",
  );

  return identity;
}

/**
 * Issues this store its identity if it has none, and reports the identity it ends
 * up with either way.
 *
 * Never overwrites: reissuing an id on a store that already had one would let a
 * reset quietly re-earn the trust the reset should have cost it. The migration
 * runs the same insert, so this covers the store that was emptied afterwards.
 */
export async function provisionStoreIdentity(input: {
  database: StoreIdentityProvisionDatabase;
  storeId?: string;
}): Promise<StoreIdentityProvisionResult> {
  const inserted = await input.database
    .insert(storeIdentity)
    .values(input.storeId ? { id: 1, storeId: input.storeId } : { id: 1 })
    .onConflictDoNothing({ target: storeIdentity.id })
    .returning({ storeId: storeIdentity.storeId });

  const insertedStoreId = inserted[0]?.storeId;
  if (insertedStoreId !== undefined) {
    return { provisioned: true, storeId: insertedStoreId };
  }

  const existingStoreId = await readStoreIdentity(input.database);
  if (existingStoreId === undefined) {
    throw new Error("store_identity_provision_failed");
  }

  return { provisioned: false, storeId: existingStoreId };
}
