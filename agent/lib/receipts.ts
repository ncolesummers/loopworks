import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJsonStringify } from "./canonical-json";

export function createExecutionReceipt(payload: unknown, secret: string): string {
  if (!secret.trim()) throw new Error("Execution receipt secret is required.");
  return createHmac("sha256", secret).update(canonicalJsonStringify(payload)).digest("hex");
}

export function verifyExecutionReceipt(payload: unknown, receipt: string, secret: string): boolean {
  const expected = Buffer.from(createExecutionReceipt(payload, secret), "hex");
  const actual = Buffer.from(receipt, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
