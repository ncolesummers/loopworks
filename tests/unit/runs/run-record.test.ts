/** @vitest-environment node */
import { eq } from "drizzle-orm";

import { artifacts, loopRuns, repositories, storeIdentity } from "@/db/schema";
import { createResearchLoopRun } from "@/lib/loops/research-run";
import {
  createValidationReportArtifactMetadata,
  type ValidationReportV1,
} from "@/lib/loops/validation-report";
import {
  provisionStoreIdentity,
  type StoreIdentityProvisionDatabase,
} from "@/lib/portal/store-identity";
import { buildRunFixtureRecords } from "@/lib/runs/fixtures";
import {
  getRunRecordsForPortal,
  getRunRecordsForResult,
  getRunSourceLabel,
  readRunRecords,
} from "@/lib/runs/run-record";
import { demoSeedIds, type SeedDatabase, seedDemoData } from "@/lib/seed/demo-data";

import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

describe("run records (pglite integration)", () => {
  let context: PgliteTestDatabase;

  beforeAll(async () => {
    context = await createPgliteTestDatabase();
  }, pgliteTestHookTimeoutMs);

  beforeEach(async () => {
    await context.reset();
  }, pgliteTestHookTimeoutMs);

  afterAll(async () => {
    await context.close();
  }, pgliteTestHookTimeoutMs);

  function testDatabase(): SeedDatabase {
    return context.db as unknown as SeedDatabase;
  }

  function validationReport(results: ValidationReportV1["results"]): ValidationReportV1 {
    return {
      counts: {
        failed: results.filter((result) => result.outcome === "fail").length,
        passed: results.filter((result) => result.outcome === "pass").length,
        skipped: results.filter((result) => result.outcome === "skipped").length,
        total: results.length,
      },
      generatedAt: "2026-07-08T16:00:00.000Z",
      overallOutcome: results.some((result) => result.outcome === "fail")
        ? "fail"
        : results.some((result) => result.outcome === "pass")
          ? "pass"
          : "skipped",
      results,
      schemaId: "loopworks.validation_report.v1",
      version: 1,
    };
  }

  it("prioritizes waiting-for-approval and blocked runs for operator triage", async () => {
    await seedDemoData(testDatabase());

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.source).toBe("db");
    expect(result.runs.map((run) => run.status).slice(0, 2)).toEqual([
      "waiting_for_approval",
      "blocked",
    ]);

    const waiting = result.runs[0];
    expect(waiting.priorityLabel).toBe("Waiting approval");
    expect(waiting.approvals).toHaveLength(1);
    expect(waiting.approvals[0]).toMatchObject({
      scope: "deploy-preview",
      status: "requested",
      requestedBy: "morgan-dev",
    });

    const blocked = result.runs[1];
    expect(blocked.priorityLabel).toBe("Blocked");
    expect(blocked.blockedReason).toContain("missing Vercel scope grant");
  });

  it("returns a run detail with steps, validation evidence, artifacts, and safe external links", async () => {
    await seedDemoData(testDatabase());

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    const succeeded = result.runs.find((run) => run.status === "succeeded");

    expect(succeeded).toBeDefined();
    expect(succeeded?.repositoryFullName).toBe("ncolesummers/loopworks-web");
    expect(succeeded?.steps.map((step) => step.status)).toContain("succeeded");
    expect(succeeded?.steps.some((step) => step.validationCommand === "bun run validate")).toBe(
      true,
    );
    expect(succeeded?.artifacts.map((artifact) => artifact.label)).toEqual(
      expect.arrayContaining(["Applied patch", "PR intent", "Deployment summary"]),
    );
    expect(succeeded?.artifacts.every((artifact) => artifact.href.startsWith("https://"))).toBe(
      true,
    );
    expect(succeeded?.approvals.map((approval) => approval.status)).toEqual(
      expect.arrayContaining(["approved", "applied"]),
    );
  });

  it("projects persisted validation report gates onto run detail summaries", async () => {
    await seedDemoData(testDatabase());
    const report = validationReport([
      {
        command: "bun run check",
        durationMs: 1800,
        exitCode: 0,
        key: "format",
        message: "Biome check passed.",
        name: "Biome check",
        outcome: "pass",
        output: {
          sha256: "a".repeat(64),
          stderrBytes: 0,
          stdoutBytes: 42,
          truncated: false,
          uri: "https://github.com/ncolesummers/loopworks/actions/runs/76-format",
        },
        phase: "before_review",
        produces: "validation_report",
        required: true,
      },
      {
        command: "bun run test",
        durationMs: 72_000,
        exitCode: 1,
        key: "unit-tests",
        message: "A focused unit test failed.",
        name: "Unit tests",
        outcome: "fail",
        output: {
          sha256: "b".repeat(64),
          stderrBytes: 128,
          stdoutBytes: 0,
          truncated: false,
          uri: "https://github.com/ncolesummers/loopworks/actions/runs/76-unit",
        },
        phase: "before_review",
        produces: "validation_report",
        required: true,
      },
      {
        command: "bun run test:e2e",
        durationMs: 0,
        exitCode: null,
        key: "playwright",
        name: "Playwright",
        outcome: "skipped",
        phase: "before_rollout",
        produces: "validation_report",
        required: false,
        skipReason: "No browser-impacting change in this fixture.",
      },
    ]);

    await context.db
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(report),
      })
      .where(eq(artifacts.id, demoSeedIds.artifacts.validationReport));

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    const failed = result.runs.find((run) => run.status === "failed");
    const succeeded = result.runs.find((run) => run.status === "succeeded");

    expect(failed?.validationSummary).toMatchObject({
      state: "ready",
      detail: "Validation report: 1 passed, 1 failed, 1 skipped.",
      generatedAt: "2026-07-08T16:00:00.000Z",
    });
    expect(failed?.validationSummary.gates).toEqual([
      expect.objectContaining({
        command: "bun run check",
        detail: "Biome check passed.",
        duration: "1.8s",
        key: "format",
        name: "Biome check",
        outcome: "pass",
        rawArtifactHref: "https://github.com/ncolesummers/loopworks/actions/runs/76-format",
        required: true,
      }),
      expect.objectContaining({
        command: "bun run test",
        detail: "A focused unit test failed.",
        duration: "1m 12s",
        key: "unit-tests",
        name: "Unit tests",
        outcome: "fail",
        rawArtifactHref: "https://github.com/ncolesummers/loopworks/actions/runs/76-unit",
        required: true,
      }),
      expect.objectContaining({
        command: "bun run test:e2e",
        detail: "No browser-impacting change in this fixture.",
        duration: "0s",
        key: "playwright",
        name: "Playwright",
        outcome: "skipped",
        rawArtifactHref: undefined,
        required: false,
      }),
    ]);
    expect(succeeded?.validationSummary).toMatchObject({
      state: "ready",
      gates: expect.arrayContaining([
        expect.objectContaining({
          key: "typecheck",
          outcome: "pass",
        }),
      ]),
    });
  });

  it("degrades validation summaries for empty and malformed completed reports", async () => {
    await seedDemoData(testDatabase());

    await context.db
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(validationReport([])),
      })
      .where(eq(artifacts.id, demoSeedIds.artifacts.validationReport));

    const emptyResult = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    expect(
      emptyResult.runs.find((run) => run.status === "failed")?.validationSummary,
    ).toMatchObject({
      state: "empty",
      gates: [],
    });

    await context.db
      .update(artifacts)
      .set({
        metadata: {
          validationReportMetadataKind: "validation_report_result",
          validationReportSchemaId: "loopworks.validation_report.v1",
          validationReportVersion: 1,
          validationReport: {
            counts: { failed: 0, passed: 1, skipped: 0, total: 2 },
            generatedAt: "2026-07-08T16:00:00.000Z",
            overallOutcome: "pass",
            results: [],
            schemaId: "loopworks.validation_report.v1",
            version: 1,
          },
        },
      })
      .where(eq(artifacts.id, demoSeedIds.artifacts.validationReport));

    const malformedResult = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    expect(
      malformedResult.runs.find((run) => run.status === "failed")?.validationSummary,
    ).toMatchObject({
      state: "error",
      gates: [],
    });
  });

  it("does not show stale validation evidence when the newest report artifact is malformed", async () => {
    await seedDemoData(testDatabase());
    await context.db
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(
          validationReport([
            {
              command: "bun run check",
              durationMs: 1000,
              exitCode: 0,
              key: "format",
              name: "Biome check",
              outcome: "pass",
              phase: "before_review",
              produces: "validation_report",
              required: true,
            },
          ]),
        ),
      })
      .where(eq(artifacts.id, demoSeedIds.artifacts.validationReport));
    await context.db.insert(artifacts).values({
      createdAt: new Date("2027-07-08T16:10:00.000Z"),
      id: "06000000-0000-4000-8000-000000000099",
      metadata: {
        detail: "Malformed report metadata without a result kind.",
      },
      runId: demoSeedIds.loopRuns.failed,
      stepId: demoSeedIds.runSteps.failed,
      title: "Malformed validation report",
      type: "validation_report",
      uri: "https://github.com/ncolesummers/loopworks/actions/runs/malformed",
    });

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });

    expect(result.runs.find((run) => run.status === "failed")?.validationSummary).toMatchObject({
      state: "error",
      gates: [],
    });
  });

  it("orders same-priority runs by full queued timestamp across days", async () => {
    await seedDemoData(testDatabase());

    await context.db
      .update(loopRuns)
      .set({
        queuedAt: new Date("2026-06-29T23:00:00.000Z"),
        status: "failed",
      })
      .where(eq(loopRuns.id, demoSeedIds.loopRuns.failed));
    await context.db
      .update(loopRuns)
      .set({
        queuedAt: new Date("2026-06-30T08:00:00.000Z"),
        status: "failed",
      })
      .where(eq(loopRuns.id, demoSeedIds.loopRuns.succeeded));

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-06-30T09:10:00.000Z"),
    });
    const failedRunIds = result.runs.filter((run) => run.status === "failed").map((run) => run.id);

    expect(failedRunIds.indexOf(demoSeedIds.loopRuns.failed)).toBeLessThan(
      failedRunIds.indexOf(demoSeedIds.loopRuns.succeeded),
    );
  });

  it("keeps fixture fallback explicit and never returns fixtures for unavailable production data", () => {
    const fixtureRuns = buildRunFixtureRecords();

    expect(
      getRunRecordsForResult(
        {
          source: "fixtures",
          fallbackReason: "database_unavailable",
          runs: [],
          usedFallback: true,
        },
        fixtureRuns,
      ),
    ).toEqual(fixtureRuns);

    expect(
      getRunRecordsForResult(
        {
          error: "Run data store unavailable.",
          source: "unavailable",
          runs: [],
          usedFallback: false,
        },
        fixtureRuns,
      ),
    ).toEqual([]);
  });

  it("includes a completed issue-43 research fixture with all stage and artifact contracts", () => {
    const researchRun = buildRunFixtureRecords().find((run) => run.id === "fixture-run-research");

    expect(researchRun).toMatchObject({
      currentStage: "done",
      issue: "#43",
      loopKey: "research-loop",
      status: "succeeded",
    });
    expect(researchRun?.steps.map((step) => step.title)).toEqual([
      "Planning",
      "Researching",
      "Authoring",
      "Done",
    ]);
    expect(researchRun?.artifacts.map((artifact) => artifact.label)).toEqual([
      "Research plan",
      "Findings artifacts",
      "Research document",
      "Completion summary",
    ]);
  });

  it("projects persisted research stages and semantic artifacts without fixture-only fallbacks", async () => {
    await context.db.insert(repositories).values({
      enabledLoops: ["Research routing"],
      fullName: "ncolesummers/loopworks",
      githubRepoId: 43_000_043,
      name: "loopworks",
      owner: "ncolesummers",
      validationGates: ["Focused tests"],
    });
    await createResearchLoopRun({
      database: context.db as never,
      now: () => new Date("2026-07-21T16:00:00.000Z"),
      trigger: {
        deliveryId: "run-record-research-delivery",
        issueNumber: 43,
        repositoryFullName: "ncolesummers/loopworks",
      },
    });

    const result = await readRunRecords({
      database: context.db,
      now: new Date("2026-07-21T16:10:00.000Z"),
    });
    expect(result.source).toBe("db");
    const researchRun = result.runs.find((run) => run.loopKey === "research-loop");
    expect(researchRun?.steps.map((step) => step.kind)).toEqual([
      "planning",
      "research",
      "authoring",
      "done",
    ]);
    expect(researchRun?.artifacts.map((artifact) => artifact.kind)).toEqual([
      "review",
      "log",
      "log",
      "log",
    ]);
  });

  it("uses explicit non-production fixture mode without reading run records", async () => {
    const fixtureRuns = buildRunFixtureRecords();
    const database = {
      select: vi.fn(() => {
        throw new Error("database should not be read");
      }),
    };

    const result = await getRunRecordsForPortal({
      database: database as never,
      env: {
        LOOPWORKS_PORTAL_DATA_MODE: "fixtures",
        NODE_ENV: "development",
      },
      fixtureRuns,
    });

    expect(database.select).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fallbackReason: "explicit_fixture_mode",
      runs: fixtureRuns,
      source: "fixtures",
      usedFallback: true,
    });
  });

  /**
   * `/runs` reads through `getRunRecordsForPortal`, not the portal-records gate, so
   * it needs its own coverage that a wrong or emptied store cannot render as a
   * normal empty list of runs (#158). Without the gate this returns `source: "db"`
   * and the page shows "Live runs" over "No runs available" while every other
   * surface refuses the same store.
   */
  it.each([
    ["is not the expected one", false],
    ["was emptied", true],
  ] as const)("fails closed on /runs when the store %s", async (_case, emptyTheStore) => {
    const logger = { warn: vi.fn() };
    const provisioned = await provisionStoreIdentity({
      database: context.db as unknown as StoreIdentityProvisionDatabase,
    });
    if (emptyTheStore) {
      await context.db.delete(storeIdentity);
    }

    const result = await getRunRecordsForPortal({
      database: context.db,
      env: {
        LOOPWORKS_EXPECTED_STORE_ID: emptyTheStore
          ? provisioned.storeId
          : "018f7c2e-0000-7c3d-9e4f-2a6b8c0d1e2f",
        NODE_ENV: "production",
      },
      fixtureRuns: buildRunFixtureRecords(),
      logger: logger as never,
    });

    expect(result).toMatchObject({
      error: "Run data store identity is unverified.",
      source: "unavailable",
      usedFallback: false,
    });
    expect(getRunSourceLabel(result)).toBe("Unavailable");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        identityStatus: emptyTheStore ? "unprovisioned" : "mismatch",
      }),
      "portal_store_identity_unverified",
    );
  });

  it("still reads runs on /runs when the expected store answers", async () => {
    const provisioned = await provisionStoreIdentity({
      database: context.db as unknown as StoreIdentityProvisionDatabase,
    });

    const result = await getRunRecordsForPortal({
      database: context.db,
      env: {
        LOOPWORKS_EXPECTED_STORE_ID: provisioned.storeId,
        NODE_ENV: "production",
      },
      fixtureRuns: buildRunFixtureRecords(),
    });

    expect(result).toMatchObject({ source: "db" });
    expect(getRunSourceLabel(result)).toBe("Live runs");
  });

  it("never honors explicit run fixture mode in production", async () => {
    const fixtureRuns = buildRunFixtureRecords();
    const database = {
      select: vi.fn(() => {
        throw new Error("database unavailable");
      }),
    };

    const result = await getRunRecordsForPortal({
      database: database as never,
      env: {
        // Configured so the read is reached: a store whose identity cannot be
        // verified fails before querying, which would satisfy the assertion below
        // for the wrong reason (#158).
        LOOPWORKS_EXPECTED_STORE_ID: "018f7c2e-5b1a-7c3d-9e4f-2a6b8c0d1e2f",
        LOOPWORKS_PORTAL_DATA_MODE: "fixtures",
        NODE_ENV: "production",
      },
      fixtureRuns,
    });

    expect(database.select).toHaveBeenCalled();
    expect(result).toMatchObject({
      source: "unavailable",
      usedFallback: false,
    });
  });
});
