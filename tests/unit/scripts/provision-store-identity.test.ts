/** @vitest-environment node */

import type { StoreIdentityProvisionDatabase } from "@/lib/portal/store-identity";

import {
  type ProvisionStoreIdentityCliDependencies,
  runProvisionStoreIdentityCli,
} from "../../../scripts/provision-store-identity";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("provision-store-identity CLI", () => {
  let context: PgliteTestDatabase;

  // PGlite's insert builder carries a driver-specific result type, so the handle
  // needs the same cast the seed suites use for `SeedDatabase`.
  function dependencies(): ProvisionStoreIdentityCliDependencies {
    return { database: context.db as unknown as StoreIdentityProvisionDatabase };
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

  it("fails the check on a store carrying no identity", async () => {
    const result = await runProvisionStoreIdentityCli(["--check"], dependencies());

    expect(result.exitCode).toBe(1);
    expect(result.lines.join("\n")).toContain("No store identity is recorded");
  });

  it("issues an identity and names the variable the operator must set", async () => {
    const result = await runProvisionStoreIdentityCli([], dependencies());

    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatch(
      /^Provisioned store identity [0-9a-f-]{36}$/, //
    );
    expect(result.lines.join("\n")).toContain("LOOPWORKS_EXPECTED_STORE_ID");
  });

  it("passes the check once an identity exists, reporting the same value", async () => {
    const provisioned = await runProvisionStoreIdentityCli([], dependencies());
    const storeId = provisioned.lines[0]?.replace("Provisioned store identity ", "");

    const checked = await runProvisionStoreIdentityCli(["--check"], dependencies());

    expect(checked.exitCode).toBe(0);
    expect(checked.lines).toEqual([`Store identity ${storeId}`]);
  });

  /**
   * The property the fix depends on: a second run cannot mint a new identity, so
   * an emptied store cannot quietly re-earn the trust the reset should have cost.
   */
  it("leaves an existing identity untouched when run again", async () => {
    const first = await runProvisionStoreIdentityCli([], dependencies());
    const storeId = first.lines[0]?.replace("Provisioned store identity ", "");

    const second = await runProvisionStoreIdentityCli([], dependencies());

    expect(second.exitCode).toBe(0);
    expect(second.lines[0]).toBe(`Store identity ${storeId} already recorded; left unchanged.`);
  });

  it("rejects unknown arguments rather than guessing an action", async () => {
    const result = await runProvisionStoreIdentityCli(["--force"], dependencies());

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["Usage: bun run db:provision [--check]"]);
  });
});
