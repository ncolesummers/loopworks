/** @vitest-environment node */
import { and, eq } from "drizzle-orm";

import { artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  applyDevelopmentLoopValidationReport,
  completeDevelopmentLoopRun,
  retryDevelopmentLoopStep,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  validationReportSchemaId,
  validationReportV1Schema,
  type ValidationGateResultV1,
  type ValidationReportV1,
} from "@/lib/loops/validation-report";
import type { LoopworksLogger } from "@/lib/observability/logger";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const issueTrigger = {
  body: "## Acceptance Criteria\n- Lifecycle telemetry records deterministic validation outcomes.",
  deliveryId: "issue-73-delivery",
  issueNumber: 73,
  issueUrl: "https://github.com/ncolesummers/loopworks/issues/73",
  labels: ["agent-ready", "area:loops", "area:validation", "area:observability"],
  milestone: "M4 Validation + PR Path + MVP Security Review",
  repositoryFullName: "ncolesummers/loopworks",
  title: "Add lifecycle telemetry to deterministic validation and run transitions",
};

function testRunDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

function transitionDatabase(context: PgliteTestDatabase): DevelopmentLoopTransitionDatabase {
  return context.db as unknown as DevelopmentLoopTransitionDatabase;
}

async function insertRepository(context: PgliteTestDatabase) {
  await context.db.insert(repositories).values({
    githubRepoId: 73_000_001,
    owner: "ncolesummers",
    name: "loopworks",
    fullName: "ncolesummers/loopworks",
    enabledLoops: ["Agent-ready development loop"],
    validationGates: ["Focused tests", "Aggregate validation"],
  });
}

async function createRun(context: PgliteTestDatabase) {
  await insertRepository(context);

  const run = await createDevelopmentLoopRun({
    database: testRunDatabase(context),
    now: () => new Date("2026-07-08T16:00:00.000Z"),
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    trigger: issueTrigger,
  });

  if (run.mode !== "created") {
    throw new Error("Expected test run creation.");
  }

  return run.runId;
}

function gateResult(input: {
  durationMs: number;
  exitCode: number | null;
  key: string;
  outcome: "pass" | "fail" | "skipped";
  required: boolean;
  skipReason?: string;
}): ValidationGateResultV1 {
  return {
    command: `bun run ${input.key}`,
    durationMs: input.durationMs,
    exitCode: input.exitCode,
    key: input.key,
    name: input.key
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    outcome: input.outcome,
    phase: "before_review",
    produces: "validation_report",
    required: input.required,
    ...(input.skipReason ? { skipReason: input.skipReason } : {}),
  };
}

function validationReport(results: ValidationGateResultV1[]): ValidationReportV1 {
  const counts = {
    failed: results.filter((result) => result.outcome === "fail").length,
    passed: results.filter((result) => result.outcome === "pass").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    total: results.length,
  };

  return validationReportV1Schema.parse({
    counts,
    generatedAt: "2026-07-08T16:05:00.000Z",
    overallOutcome: counts.failed > 0 ? "fail" : counts.passed > 0 ? "pass" : "skipped",
    results,
    schemaId: validationReportSchemaId,
    version: 1,
  });
}

function createMetricRecorder() {
  return {
    runCompleted: vi.fn(),
    runDuration: vi.fn(),
    stepDuration: vi.fn(),
    stepRetry: vi.fn(),
    validationDuration: vi.fn(),
    validationOutcome: vi.fn(),
  };
}

describe("development-loop run transitions", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("persists a passing validation report, advances to review, and skips optional telemetry", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
      gateResult({
        durationMs: 0,
        exitCode: null,
        key: "playwright",
        outcome: "skipped",
        required: false,
        skipReason: "No UI change in this issue.",
      }),
    ]);

    const validationStepBefore = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")))
      .limit(1);
    const validationArtifactBefore = await context.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, runId),
          eq(artifacts.stepId, validationStepBefore[0]?.id ?? ""),
          eq(artifacts.type, "validation_report"),
        ),
      )
      .limit(1);

    await expect(
      applyDevelopmentLoopValidationReport({
        database: transitionDatabase(context),
        metrics,
        occurredAt: new Date("2026-07-08T16:05:00.000Z"),
        report,
        runId,
      }),
    ).resolves.toMatchObject({
      runId,
      status: "advanced",
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));
    const validationArtifacts = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "validation_report")));
    const [validationArtifact] = validationArtifacts.filter(
      (artifact) => artifact.stepId === validationStep?.id,
    );

    expect(run).toMatchObject({
      currentStage: "code-review",
      status: "running",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(run.metadata).not.toMatchObject({
      blockedReason: expect.any(String),
    });
    expect(validationStep).toMatchObject({
      id: validationStepBefore[0]?.id,
      status: "succeeded",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      validationStatus: "passed",
    });
    expect(validationArtifacts).toHaveLength(2);
    expect(validationArtifact).toMatchObject({
      id: validationArtifactBefore[0]?.id,
      runId,
      stepId: validationStep?.id,
      type: "validation_report",
    });
    expect(validationArtifact?.metadata).toMatchObject({
      validationReportMetadataKind: "validation_report_result",
      validationReport: report,
      validationReportSchemaId,
      validationReportVersion: 1,
    });
    expect(metrics.validationOutcome).toHaveBeenCalledTimes(1);
    expect(metrics.validationOutcome).toHaveBeenCalledWith({
      command: "bun run focused-tests",
      gate: "focused-tests",
      status: "pass",
    });
    expect(metrics.validationDuration).toHaveBeenCalledTimes(1);
    expect(metrics.stepDuration).toHaveBeenCalledWith({
      durationSeconds: 1,
      loopKey: "development-loop",
      stage: "validation",
      status: "succeeded",
    });
  });

  it("blocks downstream stages when validation fails while preserving inspectable artifacts", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
      gateResult({
        durationMs: 2000,
        exitCode: 1,
        key: "aggregate-validation",
        outcome: "fail",
        required: true,
      }),
    ]);

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));
    const [validationArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.runId, runId),
          eq(artifacts.stepId, validationStep?.id ?? ""),
          eq(artifacts.type, "validation_report"),
        ),
      );

    expect(run).toMatchObject({
      currentStage: "validation",
      status: "blocked",
    });
    expect(run.metadata).toMatchObject({
      blockedReason: "Deterministic validation failed before review.",
    });
    expect(validationStep).toMatchObject({
      status: "failed",
      validationStatus: "failed",
    });
    expect(validationArtifact.metadata).toMatchObject({
      validationReportMetadataKind: "validation_report_result",
      validationReport: report,
    });
    expect(metrics.validationOutcome).toHaveBeenCalledWith({
      command: "bun run aggregate-validation",
      gate: "aggregate-validation",
      status: "fail",
    });
    expect(metrics.stepDuration).toHaveBeenCalledWith({
      durationSeconds: 3,
      loopKey: "development-loop",
      stage: "validation",
      status: "failed",
    });
  });

  it("blocks required skipped gates without emitting skipped validation metrics", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
      gateResult({
        durationMs: 0,
        exitCode: null,
        key: "aggregate-validation",
        outcome: "skipped",
        required: true,
        skipReason: "Required gate was unavailable.",
      }),
    ]);

    expect(report.overallOutcome).toBe("pass");

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    expect(run).toMatchObject({
      currentStage: "validation",
      status: "blocked",
    });
    expect(run.metadata).toMatchObject({
      blockedReason: "Required validation gate skipped before review.",
    });
    expect(validationStep).toMatchObject({
      status: "failed",
      validationStatus: "failed",
    });
    expect(metrics.validationOutcome).toHaveBeenCalledTimes(1);
    expect(metrics.validationOutcome).not.toHaveBeenCalledWith(
      expect.objectContaining({
        status: "skipped",
      }),
    );
  });

  it("fails closed when required validation gates are missing from the report", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
    ]);

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      expectedValidationGates: [
        { key: "focused-tests", required: true },
        { key: "aggregate-validation", required: true },
      ],
      metrics,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    expect(run).toMatchObject({
      currentStage: "validation",
      status: "blocked",
    });
    expect(run.metadata).toMatchObject({
      blockedReason: "Required validation gate missing before review.",
    });
    expect(validationStep).toMatchObject({
      status: "failed",
      validationStatus: "failed",
    });
    expect(metrics.validationOutcome).toHaveBeenCalledTimes(1);
  });

  it("does not emit duplicate validation metrics when the same report transition is replayed", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
    ]);

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });
    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });

    expect(metrics.validationOutcome).toHaveBeenCalledTimes(1);
    expect(metrics.validationDuration).toHaveBeenCalledTimes(1);
    expect(metrics.stepDuration).toHaveBeenCalledTimes(1);
  });

  it("includes persisted trace ids in transition logs without active trace context", async () => {
    const runId = await createRun(context);
    const loggerInfo = vi.fn();
    const logger = {
      info: loggerInfo,
    } as unknown as LoopworksLogger;
    const report = validationReport([
      gateResult({
        durationMs: 1000,
        exitCode: 0,
        key: "focused-tests",
        outcome: "pass",
        required: true,
      }),
    ]);

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      logger,
      occurredAt: new Date("2026-07-08T16:05:00.000Z"),
      report,
      runId,
    });

    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      }),
      "development_loop_validation_transition_persisted",
    );
  });

  it.each([
    { expectedMetricStatus: "succeeded", status: "succeeded" },
    { expectedMetricStatus: "failed", status: "failed" },
    { expectedMetricStatus: "cancelled", status: "canceled" },
  ] as const)("completes a run as $status and emits run lifecycle metrics", async ({
    expectedMetricStatus,
    status,
  }) => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    await context.db
      .update(loopRuns)
      .set({
        currentStage: "done",
        startedAt: new Date("2026-07-08T16:00:00.000Z"),
        status: "running",
      })
      .where(eq(loopRuns.id, runId));

    await completeDevelopmentLoopRun({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:10:00.000Z"),
      runId,
      status,
    });
    await completeDevelopmentLoopRun({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:10:00.000Z"),
      runId,
      status,
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));

    expect(run).toMatchObject({
      status,
      completedAt: new Date("2026-07-08T16:10:00.000Z"),
    });
    if (status === "canceled") {
      expect(run.canceledAt).toEqual(new Date("2026-07-08T16:10:00.000Z"));
    }
    expect(metrics.runCompleted).toHaveBeenCalledWith({
      loopKey: "development-loop",
      repository: "ncolesummers/loopworks",
      status,
    });
    expect(metrics.runDuration).toHaveBeenCalledWith({
      durationSeconds: 600,
      loopKey: "development-loop",
      status,
    });
    expect(metrics.runCompleted).toHaveBeenCalledTimes(1);
    expect(metrics.runDuration).toHaveBeenCalledTimes(1);
    expect(expectedMetricStatus).toBe(status === "canceled" ? "cancelled" : status);
  });

  it("queues a retry for an implemented transition branch and records retry telemetry", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    await context.db
      .update(runSteps)
      .set({
        completedAt: new Date("2026-07-08T16:05:00.000Z"),
        startedAt: new Date("2026-07-08T16:04:00.000Z"),
        status: "failed",
      })
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    await retryDevelopmentLoopStep({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:06:00.000Z"),
      reason: "validation_failed",
      runId,
      stage: "validation",
    });

    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    expect(run).toMatchObject({
      currentStage: "validation",
      status: "queued",
    });
    expect(validationStep).toMatchObject({
      attempt: 2,
      completedAt: null,
      queuedAt: new Date("2026-07-08T16:06:00.000Z"),
      startedAt: null,
      status: "queued",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(metrics.stepRetry).toHaveBeenCalledWith({
      loopKey: "development-loop",
      reason: "validation_failed",
      stage: "validation",
    });
  });

  it("does not duplicate retry telemetry and sanitizes unsafe retry reasons", async () => {
    const runId = await createRun(context);
    const metrics = createMetricRecorder();
    await context.db
      .update(runSteps)
      .set({
        completedAt: new Date("2026-07-08T16:05:00.000Z"),
        startedAt: new Date("2026-07-08T16:04:00.000Z"),
        status: "failed",
      })
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    await retryDevelopmentLoopStep({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:06:00.000Z"),
      reason: "validation failed token=secret",
      runId,
      stage: "validation",
    });
    await retryDevelopmentLoopStep({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-08T16:06:00.000Z"),
      reason: "validation failed token=secret",
      runId,
      stage: "validation",
    });

    const [validationStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "validation")));

    expect(validationStep).toMatchObject({
      attempt: 2,
      status: "queued",
    });
    expect(validationStep.metadata).toMatchObject({
      lastRetryReason: "unspecified",
    });
    expect(metrics.stepRetry).toHaveBeenCalledTimes(1);
    expect(metrics.stepRetry).toHaveBeenCalledWith({
      loopKey: "development-loop",
      reason: "unspecified",
      stage: "validation",
    });
  });
});
