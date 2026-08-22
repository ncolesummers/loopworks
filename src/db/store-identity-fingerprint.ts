import { createHash } from "node:crypto";

/**
 * Reviewed SHA-256 trust root for Production's store identity. The underlying
 * identity is intentionally never checked in: Preview compares only a supplied
 * identity's digest so copied Production configuration fails without exposing
 * the raw Production UUID.
 */
export const productionStoreIdentityFingerprint =
  "a81103cf21d6637d74efcc349ba902b03585bb1e5f5d646873ebe084edb8833d";

export function assertPreviewStoreIdentityIsNotProduction(
  storeIdentity: string,
  fingerprint: (value: string) => string = (value) =>
    createHash("sha256").update(value).digest("hex"),
): void {
  if (fingerprint(storeIdentity.trim().toLowerCase()) === productionStoreIdentityFingerprint) {
    throw new Error("Preview LOOPWORKS_EXPECTED_STORE_ID matches the Production store identity.");
  }
}
