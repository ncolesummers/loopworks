/** @vitest-environment node */

import { portalFixture } from "@/lib/fixtures";
import {
  getPortalRecordsForPortal,
  getPortalSourceLabel,
  readPortalRecords,
} from "@/lib/portal/records";
import { seedDemoData, type SeedDatabase } from "@/lib/seed/demo-data";

import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

describe("portal records (pglite integration)", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  function testDatabase(): SeedDatabase {
    return context.db as unknown as SeedDatabase;
  }

  it("materializes the five portal page surfaces from seeded database rows", async () => {
    await seedDemoData(testDatabase());

    const result = await readPortalRecords({
      database: context.db,
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

  it("fails closed for reachable production databases that are missing required portal rows", async () => {
    const result = await getPortalRecordsForPortal({
      database: context.db,
      env: { NODE_ENV: "production" },
      now: new Date("2026-06-30T09:10:00.000Z"),
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
    expect(result.records.githubSettings).toEqual([]);
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
    });

    expect(result).toMatchObject({
      fallbackReason: "database_unavailable",
      source: "fixtures",
      usedFallback: true,
    });
    expect(result.records.repos).toEqual(portalFixture.repos);
    expect(result.records.loops).toEqual(portalFixture.loops);
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
          githubSettings: [],
          loops: [],
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
          githubSettings: portalFixture.githubSettings,
          loops: portalFixture.loops,
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
          githubSettings: [],
          loops: [],
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
