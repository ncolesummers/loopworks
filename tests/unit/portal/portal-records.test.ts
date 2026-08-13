/** @vitest-environment node */

import { repositories, storeIdentity } from "@/db/schema";
import { portalFixture } from "@/lib/fixtures";
import {
  findUnmetPortalRequirements,
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  hasPortalProjectionIntegrity,
  readPortalRecords,
} from "@/lib/portal/records";
import {
  provisionStoreIdentity,
  type StoreIdentityProvisionDatabase,
} from "@/lib/portal/store-identity";
import { type SeedDatabase, seedDemoData } from "@/lib/seed/demo-data";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("portal records (pglite integration)", () => {
  let context: PgliteTestDatabase;

  const expectedStoreId = "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f";
  const otherStoreId = "018f7c2e-0000-7c3d-9e4f-2a6b8c0d1e2f";

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
    // `reset` truncates every public table, which takes the identity row with it
    // and leaves a store that reads as emptied rather than provisioned (#158).
    // Production reads below are about a correctly-provisioned store, so each
    // starts by reissuing the identity the deployment expects.
    await provisionStoreIdentity({
      database: context.db as unknown as StoreIdentityProvisionDatabase,
      storeId: expectedStoreId,
    });
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  function testDatabase(): SeedDatabase {
    return context.db as unknown as SeedDatabase;
  }

  /**
   * A fresh install after repository selection: repositories exist, but loop
   * registration (#126) has not run, so loops, deployments, and approvals are
   * all legitimately empty.
   */
  async function seedSelectedRepositoryOnly() {
    await context.db.insert(repositories).values({
      fullName: "loopworks-sandbox/portal-web",
      githubRepoId: 900_100,
      name: "portal-web",
      owner: "loopworks-sandbox",
    });
  }

  const productionEnv = {
    GITHUB_APP_ID: "800000",
    LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId,
    NODE_ENV: "production",
  } as const;

  it("materializes the five portal page surfaces from seeded database rows", async () => {
    await seedDemoData(testDatabase());

    const result = await readPortalRecords({
      database: context.db,
      githubAppId: 800_000,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.source).toBe("db");
    expect(result.usedFallback).toBe(false);
    expect(result.records.repos.map((repo) => repo.name)).toEqual(
      expect.arrayContaining(["loopworks-web", "factory-core", "delivery-ops"]),
    );
    expect(
      result.records.repos.find((repo) => repo.name === "loopworks-web")?.vercelProjectId,
    ).toBe("prj_demo_loopworks_web");
    expect(result.records.loops.map((loop) => loop.name)).toEqual(
      expect.arrayContaining([
        "Intake new repo requests",
        "Implement idempotency lock sweep",
        "Review deploy-gate write scope",
      ]),
    );
    expect(result.records.deployments.map((deployment) => deployment.name)).toEqual(
      expect.arrayContaining(["production/main", "preview/codex/20-seed-data"]),
    );
    expect(result.records.approval).toMatchObject({
      owner: "morgan-dev",
      state: "requested",
    });
    expect(result.records.approval?.checklist.map((item) => item.label)).toEqual(
      expect.arrayContaining(["Scope deploy-preview", "Requested by morgan-dev"]),
    );
    expect(result.records.githubSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "sso", enabled: true }),
        expect.objectContaining({ key: "issue-sync", enabled: true }),
        expect.objectContaining({ key: "label-mapping", enabled: true }),
      ]),
    );
    expect(result.records.timeline.map((event) => event.title)).toContain("Development");
    expect(result.records.artifacts.map((artifact) => artifact.label)).toContain(
      "Validation report",
    );
    expect(result.records.validationResults.map((record) => record.name)).toEqual(
      expect.arrayContaining(["Typecheck", "Unit tests", "Playwright"]),
    );
  });

  it("treats a reachable empty database as live empty state instead of fallback", async () => {
    const result = await readPortalRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result).toMatchObject({
      source: "db",
      usedFallback: false,
    });
    expect(result.records.repos).toEqual([]);
    expect(result.records.loops).toEqual([]);
    expect(result.records.deployments).toEqual([]);
    expect(result.records.approval).toBeNull();
    expect(result.records.githubSettings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "sso", enabled: false }),
        expect.objectContaining({ key: "issue-sync", enabled: false }),
      ]),
    );
  });

  it("only projects installations belonging to the active GitHub App", async () => {
    await seedDemoData(testDatabase());

    const result = await readPortalRecords({
      database: context.db,
      githubAppId: 999,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.records.githubInstallations).toEqual([]);
    expect(result.records.githubSettings).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "sso", enabled: false })]),
    );
  });

  it("projects installations and derived settings for the matching active GitHub App", async () => {
    await seedDemoData(testDatabase());

    const result = await readPortalRecords({
      database: context.db,
      githubAppId: 800_000,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.records.githubInstallations).toEqual([
      expect.objectContaining({ installationId: 800_000_001 }),
    ]);
    expect(result.records.githubSettings).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "sso", enabled: true })]),
    );
  });

  it.each([
    ["missing", {}],
    ["malformed", { GITHUB_APP_ID: "not-an-app-id" }],
    ["zero", { GITHUB_APP_ID: "0" }],
    ["negative", { GITHUB_APP_ID: "-1" }],
    ["non-integer", { GITHUB_APP_ID: "1.5" }],
    ["unsafe", { GITHUB_APP_ID: "9007199254740992" }],
  ])("projects no installations when the active GitHub App ID is %s", async (_label, env) => {
    await seedDemoData(testDatabase());

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { NODE_ENV: "development", ...env },
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result.records.githubInstallations).toEqual([]);
    expect(result.records.githubSettings).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "sso", enabled: false })]),
    );
  });

  it.each([
    ["missing", {}],
    ["malformed", { GITHUB_APP_ID: "not-an-app-id" }],
  ])("surfaces unavailable state for %s production App identity", async (_label, env) => {
    await seedDemoData(testDatabase());

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { NODE_ENV: "production", ...env },
      requires: [],
    });

    expect(result).toMatchObject({
      error: "Portal data store unavailable.",
      source: "unavailable",
      usedFallback: false,
    });
    expect(result.records.githubInstallations).toEqual([]);
    expect(result.records.githubSettings).toEqual([]);
  });

  it("keeps a selected repository visible in production without loops, deployments, or approvals", async () => {
    await seedSelectedRepositoryOnly();

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "db", usedFallback: false });
    expect(result.records.repos.map((repo) => repo.name)).toEqual(["portal-web"]);
    expect(result.records.loops).toEqual([]);
    expect(result.records.deployments).toEqual([]);
    expect(result.records.approval).toBeNull();
  });

  it("renders a legitimately empty production database as live empty rather than unavailable", async () => {
    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "db", usedFallback: false });
    expect(getPortalSourceLabel(result)).toBe("Live database");
    expect(result.records.repos).toEqual([]);
    expect(result.records.loops).toEqual([]);
    expect(result.records.deployments).toEqual([]);
    expect(result.records.approval).toBeNull();
  });

  it("fails closed and logs the unmet keys when a surface requires data the store does not have", async () => {
    const logger = { warn: vi.fn() };

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: ["repos", "loops"],
    });

    expect(result).toMatchObject({
      error: "Portal data store unavailable.",
      source: "unavailable",
      usedFallback: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalCount: 0,
        deploymentCount: 0,
        loopCount: 0,
        repositoryCount: 0,
        settingsCount: 6,
        unmetRequirements: ["repos", "loops"],
      }),
      "portal_records_required_data_missing",
    );
  });

  /**
   * #158. A reachable database that is not the expected one answers every query
   * successfully and empty, so the read below would otherwise be indistinguishable
   * from the legitimately-empty production read two tests above. These assert the
   * difference is now observable in both the result and the log stream.
   */
  it("fails closed and names the mismatch when a reachable store is not the expected one", async () => {
    const logger = { warn: vi.fn() };

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { ...productionEnv, LOOPWORKS_EXPECTED_STORE_ID: otherStoreId },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({
      error: "Portal data store identity is unverified.",
      source: "unavailable",
      usedFallback: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identityStatus: "mismatch" }),
      "portal_store_identity_unverified",
    );
  });

  it("fails closed and names the emptied store when the identity row was truncated", async () => {
    const logger = { warn: vi.fn() };
    await context.db.delete(storeIdentity);

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({
      error: "Portal data store identity is unverified.",
      source: "unavailable",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identityStatus: "unprovisioned" }),
      "portal_store_identity_unverified",
    );
  });

  it("fails closed in production when no expected store identity is configured", async () => {
    const logger = { warn: vi.fn() };

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { GITHUB_APP_ID: "800000", NODE_ENV: "production" },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({
      error: "Portal data store identity is unverified.",
      source: "unavailable",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identityStatus: "not_configured" }),
      "portal_store_identity_unverified",
    );
  });

  it("emits no identity warning for a verified store, so a new install stays silent", async () => {
    const logger = { warn: vi.fn() };

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "db" });
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "portal_store_identity_unverified",
    );
  });

  it("keeps the raw store identifiers out of the identity warning", async () => {
    const logger = { warn: vi.fn() };

    await getPortalRecordsForPortal({
      database: context.db,
      env: { ...productionEnv, LOOPWORKS_EXPECTED_STORE_ID: otherStoreId },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).not.toContain(expectedStoreId);
    expect(logged).not.toContain(otherStoreId);
  });

  /**
   * A Vercel Preview builds with `NODE_ENV=production`, so it reaches every other
   * production gate. Its database is provider-owned and turns over with the
   * Preview lifecycle (ADR 0018), so no project-level value can name it and the
   * check would fail every preview rather than catch anything. Asserted with a
   * store that would fail both ways — wrong id *and* no identity row — so the
   * exclusion cannot pass by accident.
   */
  it("does not verify store identity in a Vercel preview", async () => {
    const logger = { warn: vi.fn() };
    await context.db.delete(storeIdentity);

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: {
        GITHUB_APP_ID: "800000",
        LOOPWORKS_EXPECTED_STORE_ID: otherStoreId,
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "db" });
    expect(getPortalSourceLabel(result)).toBe("Live database");
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "portal_store_identity_unverified",
    );
  });

  it("still verifies store identity when VERCEL_ENV names production", async () => {
    const logger = { warn: vi.fn() };

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: {
        GITHUB_APP_ID: "800000",
        LOOPWORKS_EXPECTED_STORE_ID: otherStoreId,
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "unavailable" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ identityStatus: "mismatch" }),
      "portal_store_identity_unverified",
    );
  });

  it("does not verify store identity outside production runtime", async () => {
    const logger = { warn: vi.fn() };
    await context.db.delete(storeIdentity);

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { GITHUB_APP_ID: "800000", NODE_ENV: "development" },
      logger: logger as never,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: [],
    });

    expect(result).toMatchObject({ source: "db" });
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      "portal_store_identity_unverified",
    );
  });

  it("does not gate a surface whose declared requirement is met", async () => {
    await seedSelectedRepositoryOnly();

    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: productionEnv,
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: ["repos"],
    });

    expect(result).toMatchObject({ source: "db", usedFallback: false });
  });

  it("ignores declared requirements outside production runtime", async () => {
    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { GITHUB_APP_ID: "800000", NODE_ENV: "development" },
      now: new Date("2026-06-30T09:10:00.000Z"),
      requires: ["repos"],
    });

    expect(result).toMatchObject({ source: "db", usedFallback: false });
  });

  it("reports every unmet requirement kind, including the nullable approval", () => {
    expect(
      findUnmetPortalRequirements(
        {
          approval: null,
          artifacts: [],
          deployments: [],
          githubInstallations: [],
          githubSettings: [],
          loops: [],
          registeredLoops: [],
          repos: [],
          timeline: [],
          validationResults: [],
        },
        ["approval", "deployments", "githubInstallations", "loops", "repos"],
      ),
    ).toEqual(["approval", "deployments", "githubInstallations", "loops", "repos"]);
    expect(
      findUnmetPortalRequirements(
        {
          approval: portalFixture.approval,
          artifacts: [],
          deployments: portalFixture.deployments,
          githubInstallations: portalFixture.githubInstallations,
          githubSettings: portalFixture.githubSettings,
          loops: portalFixture.loops,
          registeredLoops: portalFixture.registeredLoops,
          repos: portalFixture.repos,
          timeline: [],
          validationResults: [],
        },
        ["approval", "deployments", "githubInstallations", "loops", "repos"],
      ),
    ).toEqual([]);
  });

  it("holds the settings projection contract for both empty and seeded databases", async () => {
    const empty = await readPortalRecords({
      database: context.db,
      githubAppId: 800_000,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(hasPortalProjectionIntegrity(empty.records)).toBe(true);

    await seedDemoData(testDatabase());
    const seeded = await readPortalRecords({
      database: context.db,
      githubAppId: 800_000,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(hasPortalProjectionIntegrity(seeded.records)).toBe(true);
    expect(seeded.records.githubSettings.map((record) => record.key)).toEqual(
      empty.records.githubSettings.map((record) => record.key),
    );

    // Dropping any single projected key is a contract violation, not empty data.
    for (const record of seeded.records.githubSettings) {
      expect(
        hasPortalProjectionIntegrity({
          ...seeded.records,
          githubSettings: seeded.records.githubSettings.filter((each) => each.key !== record.key),
        }),
      ).toBe(false);
    }
  });

  it("keeps non-production database failures explicit and fixture backed", async () => {
    const unavailableDatabase = {
      select() {
        throw new Error("database unavailable");
      },
    };

    const result = await getPortalRecordsForPortal({
      database: unavailableDatabase as never,
      env: { NODE_ENV: "development" },
      requires: [],
    });

    expect(result).toMatchObject({
      fallbackReason: "database_unavailable",
      source: "fixtures",
      usedFallback: true,
    });
    expect(result.records.repos).toEqual(portalFixture.repos);
    expect(result.records.loops).toEqual(portalFixture.loops);
  });

  it("uses explicit non-production fixture mode without reading the database", async () => {
    const database = {
      select: vi.fn(() => {
        throw new Error("database should not be read");
      }),
    };
    const logger = {
      warn: vi.fn(),
    };

    const result = await getPortalRecordsForPortal({
      database: database as never,
      env: {
        LOOPWORKS_PORTAL_DATA_MODE: "fixtures",
        NODE_ENV: "development",
      },
      logger: logger as never,
      requires: [],
    });

    expect(database.select).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fallbackReason: "explicit_fixture_mode",
      source: "fixtures",
      usedFallback: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      { fallbackReason: "explicit_fixture_mode" },
      "portal_records_fixture_mode_enabled",
    );
  });

  it("never honors explicit fixture mode in production", async () => {
    const unavailableDatabase = {
      select: vi.fn(() => {
        throw new Error("database unavailable");
      }),
    };

    const result = await getPortalRecordsForPortal({
      database: unavailableDatabase as never,
      env: {
        GITHUB_APP_ID: "800000",
        // Configured so the read is reached: an unidentifiable store fails before
        // querying, which would satisfy the assertion below for the wrong reason.
        LOOPWORKS_EXPECTED_STORE_ID: expectedStoreId,
        LOOPWORKS_PORTAL_DATA_MODE: "fixtures",
        NODE_ENV: "production",
      },
      requires: [],
    });

    expect(unavailableDatabase.select).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "unavailable",
      usedFallback: false,
    });
  });

  it("never returns fixtures for unavailable production database reads", async () => {
    const unavailableDatabase = {
      select() {
        throw new Error("database unavailable");
      },
    };

    const result = await getPortalRecordsForPortal({
      database: unavailableDatabase as never,
      env: { NODE_ENV: "production" },
      requires: [],
    });

    expect(result).toMatchObject({
      error: "Portal data store unavailable.",
      source: "unavailable",
      usedFallback: false,
    });
    expect(result.records.repos).toEqual([]);
    expect(result.records.loops).toEqual([]);
    expect(result.records.deployments).toEqual([]);
    expect(result.records.approval).toBeNull();
    expect(result.records.timeline).toEqual([]);
    expect(result.records.artifacts).toEqual([]);
    expect(result.records.validationResults).toEqual([]);
  });

  it("surfaces source labels that match the existing portal fallback vocabulary", () => {
    expect(
      getPortalSourceLabel({
        records: {
          approval: null,
          artifacts: [],
          deployments: [],
          githubInstallations: [],
          githubSettings: [],
          loops: [],
          registeredLoops: [],
          repos: [],
          timeline: [],
          validationResults: [],
        },
        source: "db",
        usedFallback: false,
      }),
    ).toBe("Live database");
    expect(
      getPortalSourceLabel({
        fallbackReason: "database_unavailable",
        records: {
          approval: portalFixture.approval,
          artifacts: portalFixture.artifacts,
          deployments: portalFixture.deployments,
          githubInstallations: portalFixture.githubInstallations,
          githubSettings: portalFixture.githubSettings,
          loops: portalFixture.loops,
          registeredLoops: portalFixture.registeredLoops,
          repos: portalFixture.repos,
          timeline: portalFixture.timeline,
          validationResults: portalFixture.validationResults,
        },
        source: "fixtures",
        usedFallback: true,
      }),
    ).toBe("Fixture fallback");
    expect(
      getPortalSourceLabel({
        error: "Portal data store unavailable.",
        records: {
          approval: null,
          artifacts: [],
          deployments: [],
          githubInstallations: [],
          githubSettings: [],
          loops: [],
          registeredLoops: [],
          repos: [],
          timeline: [],
          validationResults: [],
        },
        source: "unavailable",
        usedFallback: false,
      }),
    ).toBe("Unavailable");
  });
});
