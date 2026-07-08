/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { approvals, loopRuns, observabilityEvents, repositories } from "@/db/schema";
import {
  collectControlPlaneGaugeMeasurements,
  developmentLoopRunCreatedDurableMetricName,
  observabilityMetricNames,
  recordDevelopmentLoopRunCompletedMetric,
  recordApprovalWaitTimeMetric,
  recordDevelopmentLoopRunCreatedObservability,
  recordDevelopmentLoopRunDurationMetric,
  recordDevelopmentLoopRunStartedMetric,
  recordDevelopmentLoopStepDurationMetric,
  recordDevelopmentLoopStepRetryMetric,
  recordDevelopmentLoopValidationDurationMetric,
  recordDevelopmentLoopValidationOutcomeMetric,
  recordGithubWebhookOutcomeMetric,
  recordLockContentionMetric,
  registerControlPlaneGaugeMetrics,
  resolveDurableObservabilityEventDefinition,
  resolveObservabilityMetricDefinition,
} from "@/lib/observability/metrics";
import { createPgliteTestDatabase } from "../../helpers/pglite";

const repoRoot = process.cwd();

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }

    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      return [entryPath];
    }

    return [];
  });
}

function getPropertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return undefined;
}

function getLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(repoRoot, sourceFile.fileName)}:${line + 1}:${character + 1}`;
}

describe("ADR 0012 observability metric contract", () => {
  it("exports exactly the metric-name set from ADR 0012", () => {
    expect(observabilityMetricNames).toEqual([
      "loopworks.run.started",
      "loopworks.run.completed",
      "loopworks.run.duration",
      "loopworks.step.duration",
      "loopworks.step.retries",
      "loopworks.validation.outcome",
      "loopworks.validation.duration",
      "loopworks.webhook.outcome",
      "loopworks.deployment.observed",
      "loopworks.approval.wait_time",
      "loopworks.approval.pending",
      "loopworks.queue.depth",
      "loopworks.lock.contention",
      "loopworks.model.requests",
      "loopworks.model.tokens",
      "loopworks.model.cost",
    ]);
  });

  it("records development-loop run creation through the ADR metric name and attributes", () => {
    const recordings: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      value: number;
    }[] = [];
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, value });
          },
        };
      },
    };

    recordDevelopmentLoopRunStartedMetric(
      {
        loopKey: "development-loop",
        repository: "ncolesummers/loopworks",
        triggerLabel: "agent-ready",
      },
      meter,
    );

    expect(recordings).toEqual([
      {
        attributes: {
          "loop.key": "development-loop",
          repository: "ncolesummers/loopworks",
          "trigger.label": "agent-ready",
        },
        name: "loopworks.run.started",
        value: 1,
      },
    ]);
  });

  it("records current issue #64 counter and histogram metrics with ADR attributes only", () => {
    const recordings: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      type: "counter" | "histogram";
      value: number;
    }[] = [];
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, type: "counter", value });
          },
        };
      },
      createHistogram(name: string) {
        return {
          record(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, type: "histogram", value });
          },
        };
      },
    };

    recordGithubWebhookOutcomeMetric(
      {
        action: "labeled",
        event: "issues",
        outcome: "accepted",
      },
      meter,
    );
    recordApprovalWaitTimeMetric(
      {
        decision: "approved",
        durationSeconds: 300,
        gate: "pr-write",
      },
      meter,
    );
    recordLockContentionMetric(
      {
        scope: "github:webhook-delivery",
      },
      meter,
    );

    expect(recordings).toEqual([
      {
        attributes: {
          action: "labeled",
          event: "issues",
          outcome: "accepted",
        },
        name: "loopworks.webhook.outcome",
        type: "counter",
        value: 1,
      },
      {
        attributes: {
          decision: "approved",
          gate: "pr-write",
        },
        name: "loopworks.approval.wait_time",
        type: "histogram",
        value: 300,
      },
      {
        attributes: {
          scope: "github:webhook-delivery",
        },
        name: "loopworks.lock.contention",
        type: "counter",
        value: 1,
      },
    ]);
  });

  it("records lifecycle metrics with ADR attributes and cancellation spelling", () => {
    const recordings: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      type: "counter" | "histogram";
      value: number;
    }[] = [];
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, type: "counter", value });
          },
        };
      },
      createHistogram(name: string) {
        return {
          record(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, type: "histogram", value });
          },
        };
      },
    };

    recordDevelopmentLoopRunCompletedMetric(
      {
        loopKey: "development-loop",
        repository: "ncolesummers/loopworks",
        status: "canceled",
      },
      meter,
    );
    recordDevelopmentLoopRunDurationMetric(
      {
        durationSeconds: 600,
        loopKey: "development-loop",
        status: "canceled",
      },
      meter,
    );
    recordDevelopmentLoopStepDurationMetric(
      {
        durationSeconds: 12,
        loopKey: "development-loop",
        stage: "validation",
        status: "failed",
      },
      meter,
    );
    recordDevelopmentLoopStepRetryMetric(
      {
        loopKey: "development-loop",
        reason: "validation_failed",
        stage: "validation",
      },
      meter,
    );
    recordDevelopmentLoopValidationOutcomeMetric(
      {
        command: "bun run test",
        gate: "unit-tests",
        status: "fail",
      },
      meter,
    );
    recordDevelopmentLoopValidationDurationMetric(
      {
        command: "bun run test",
        durationSeconds: 4,
        gate: "unit-tests",
      },
      meter,
    );

    expect(recordings).toEqual([
      {
        attributes: {
          "loop.key": "development-loop",
          repository: "ncolesummers/loopworks",
          status: "cancelled",
        },
        name: "loopworks.run.completed",
        type: "counter",
        value: 1,
      },
      {
        attributes: {
          "loop.key": "development-loop",
          status: "cancelled",
        },
        name: "loopworks.run.duration",
        type: "histogram",
        value: 600,
      },
      {
        attributes: {
          "loop.key": "development-loop",
          stage: "validation",
          status: "failed",
        },
        name: "loopworks.step.duration",
        type: "histogram",
        value: 12,
      },
      {
        attributes: {
          "loop.key": "development-loop",
          reason: "validation_failed",
          stage: "validation",
        },
        name: "loopworks.step.retries",
        type: "counter",
        value: 1,
      },
      {
        attributes: {
          command: "bun run test",
          gate: "unit-tests",
          status: "fail",
        },
        name: "loopworks.validation.outcome",
        type: "counter",
        value: 1,
      },
      {
        attributes: {
          command: "bun run test",
          gate: "unit-tests",
        },
        name: "loopworks.validation.duration",
        type: "histogram",
        value: 4,
      },
    ]);
  });

  it("keeps lifecycle persistence independent from telemetry sink failures", () => {
    const meter = {
      createCounter() {
        throw new Error("counter unavailable");
      },
      createHistogram() {
        throw new Error("histogram unavailable");
      },
    };

    expect(() =>
      recordDevelopmentLoopRunCompletedMetric(
        {
          loopKey: "development-loop",
          repository: "ncolesummers/loopworks",
          status: "succeeded",
        },
        meter,
      ),
    ).not.toThrow();
    expect(() =>
      recordDevelopmentLoopValidationDurationMetric(
        {
          command: "bun run validate",
          durationSeconds: 1,
          gate: "aggregate-validation",
        },
        meter,
      ),
    ).not.toThrow();
  });

  it("redacts sensitive validation command metric attributes", () => {
    const recordings: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      value: number;
    }[] = [];
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, value });
          },
        };
      },
    };

    recordDevelopmentLoopValidationOutcomeMetric(
      {
        command: "bun run test --token ghp_secret",
        gate: "unit-tests",
        status: "fail",
      },
      meter,
    );

    expect(recordings).toEqual([
      {
        attributes: {
          command: "[redacted]",
          gate: "unit-tests",
          status: "fail",
        },
        name: "loopworks.validation.outcome",
        value: 1,
      },
    ]);
  });

  it("registers pending approval and queue-depth observable gauges", async () => {
    const callbacks: {
      callback: (result: {
        observe: (value: number, attributes?: Record<string, unknown>) => void;
      }) => void | Promise<void>;
      name: string;
    }[] = [];
    const observations: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      value: number;
    }[] = [];
    const meter = {
      createObservableGauge(name: string) {
        return {
          addCallback(
            callback: (result: {
              observe: (value: number, attributes?: Record<string, unknown>) => void;
            }) => void | Promise<void>,
          ) {
            callbacks.push({ callback, name });
          },
          removeCallback() {},
        };
      },
    };

    registerControlPlaneGaugeMetrics(
      {
        sources: {
          pendingApprovals: async () => [{ gate: "pr-write", value: 2 }],
          queuedRuns: async () => [{ loopKey: "development-loop", value: 3 }],
        },
      },
      meter,
    );

    for (const { callback, name } of callbacks) {
      await callback({
        observe(value, attributes) {
          observations.push({ attributes, name, value });
        },
      });
    }

    expect(observations).toEqual([
      {
        attributes: {
          gate: "pr-write",
        },
        name: "loopworks.approval.pending",
        value: 2,
      },
      {
        attributes: {
          "loop.key": "development-loop",
        },
        name: "loopworks.queue.depth",
        value: 3,
      },
    ]);
  });

  it("collects pending approval and queued-run gauge values from control-plane state", async () => {
    const context = await createPgliteTestDatabase();
    try {
      const repositoryId = "64000000-0000-4000-8000-000000000001";
      const queuedRunId = "64000000-0000-4000-8000-000000000002";
      const runningRunId = "64000000-0000-4000-8000-000000000003";

      await context.db.insert(repositories).values({
        id: repositoryId,
        githubRepoId: 64_000_001,
        owner: "ncolesummers",
        name: "loopworks",
        fullName: "ncolesummers/loopworks",
      });
      await context.db.insert(loopRuns).values([
        {
          id: queuedRunId,
          currentStage: "planning",
          loopKey: "development-loop",
          repositoryId,
          status: "queued",
        },
        {
          id: runningRunId,
          currentStage: "planning",
          loopKey: "development-loop",
          repositoryId,
          status: "running",
        },
      ]);
      await context.db.insert(approvals).values([
        {
          id: "64000000-0000-4000-8000-000000000004",
          requestedBy: "eve-builder-agent",
          runId: queuedRunId,
          scope: "pr-write",
          status: "requested",
        },
        {
          id: "64000000-0000-4000-8000-000000000005",
          requestedBy: "eve-builder-agent",
          runId: runningRunId,
          scope: "pr-write",
          status: "approved",
        },
      ]);

      await expect(collectControlPlaneGaugeMeasurements(context.db)).resolves.toEqual({
        pendingApprovals: [{ gate: "pr-write", value: 1 }],
        queuedRuns: [{ loopKey: "development-loop", value: 1 }],
      });
    } finally {
      await context.close();
    }
  }, 15_000);

  it("rejects unsupported OTel metric names", () => {
    expect(resolveObservabilityMetricDefinition("loopworks.run.started")).toMatchObject({
      instrument: "counter",
      name: "loopworks.run.started",
      requiredAttributes: ["loop.key", "repository", "trigger.label"],
      unit: "{run}",
    });

    expect(() => resolveObservabilityMetricDefinition("loopworks.run.created")).toThrow(
      "Unsupported Loopworks observability metric name: loopworks.run.created",
    );
  });

  it("rejects unsupported durable observability event metric names", () => {
    expect(
      resolveDurableObservabilityEventDefinition(developmentLoopRunCreatedDurableMetricName),
    ).toMatchObject({
      eventType: "development_loop_run_created",
      metricName: "development_loop_run_created",
      otelMetricName: "loopworks.run.started",
    });

    expect(() =>
      resolveDurableObservabilityEventDefinition("development_loop_run_started"),
    ).toThrow("Unsupported durable observability event metric name: development_loop_run_started");
  });

  it("emits the development-loop run-created durable event and OTel metric from one helper", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const recordings: {
      attributes: Record<string, unknown> | undefined;
      name: string;
      value: number;
    }[] = [];
    const writer = {
      insert(table: unknown) {
        expect(table).toBe(observabilityEvents);

        return {
          values(row: Record<string, unknown>) {
            insertedRows.push(row);
            return Promise.resolve();
          },
        };
      },
    };
    const meter = {
      createCounter(name: string) {
        return {
          add(value: number, attributes?: Record<string, unknown>) {
            recordings.push({ attributes, name, value });
          },
        };
      },
    };

    const emitMetric = await recordDevelopmentLoopRunCreatedObservability({
      artifactCount: 8,
      deliveryId: "issue-63-delivery",
      issueNumber: 63,
      loopKey: "development-loop",
      meter,
      repositoryFullName: "ncolesummers/loopworks",
      repositoryId: "64f8ca7a-1b5d-4b3f-8c5e-2e2d814a18aa",
      runId: "9a8d379f-1d65-4fb0-bd91-4f82306a3159",
      stageCount: 8,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      triggerLabel: "agent-ready",
      writer,
    });

    expect(recordings).toEqual([]);
    expect(insertedRows).toEqual([
      {
        correlationId: "issue-63-delivery",
        eventType: "development_loop_run_created",
        message: "Agent-ready development loop run skeleton created.",
        metricName: "development_loop_run_created",
        metricValue: 8,
        payload: {
          artifactCount: 8,
          issueNumber: 63,
          loopKey: "development-loop",
          repositoryFullName: "ncolesummers/loopworks",
          stageCount: 8,
        },
        repositoryId: "64f8ca7a-1b5d-4b3f-8c5e-2e2d814a18aa",
        runId: "9a8d379f-1d65-4fb0-bd91-4f82306a3159",
        severity: "info",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      },
    ]);
    emitMetric();
    expect(recordings).toEqual([
      {
        attributes: {
          "loop.key": "development-loop",
          repository: "ncolesummers/loopworks",
          "trigger.label": "agent-ready",
        },
        name: "loopworks.run.started",
        value: 1,
      },
    ]);
  });

  it("keeps the durable event insert authoritative when OTel metric emission fails", async () => {
    const insertedRows: Record<string, unknown>[] = [];
    const writer = {
      insert(table: unknown) {
        expect(table).toBe(observabilityEvents);

        return {
          values(row: Record<string, unknown>) {
            insertedRows.push(row);
            return Promise.resolve();
          },
        };
      },
    };
    const meter = {
      createCounter() {
        throw new Error("meter unavailable");
      },
    };

    const emitMetric = await recordDevelopmentLoopRunCreatedObservability({
      artifactCount: 8,
      deliveryId: "issue-63-delivery",
      issueNumber: 63,
      loopKey: "development-loop",
      meter,
      repositoryFullName: "ncolesummers/loopworks",
      repositoryId: "64f8ca7a-1b5d-4b3f-8c5e-2e2d814a18aa",
      runId: "9a8d379f-1d65-4fb0-bd91-4f82306a3159",
      stageCount: 8,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      triggerLabel: "agent-ready",
      writer,
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      eventType: "development_loop_run_created",
      metricName: "development_loop_run_created",
      runId: "9a8d379f-1d65-4fb0-bd91-4f82306a3159",
    });
    expect(() => emitMetric()).not.toThrow();
  });

  it("keeps metric names and durable metric writes behind observability helpers", () => {
    const sourceRoot = path.join(repoRoot, "src");
    const observabilityRoot = path.join(sourceRoot, "lib/observability");
    const schemaFile = path.join(sourceRoot, "db/schema.ts");
    const metricNamespacePattern =
      /^loopworks\.(run|step|validation|webhook|deployment|approval|queue|lock|model)\./;
    const forbiddenMetricLiterals = new Set([
      ...observabilityMetricNames,
      developmentLoopRunCreatedDurableMetricName,
    ]);
    const violations: string[] = [];

    for (const filePath of listSourceFiles(sourceRoot)) {
      if (filePath.startsWith(observabilityRoot)) {
        continue;
      }

      const sourceFile = ts.createSourceFile(
        filePath,
        readFileSync(filePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      function visit(node: ts.Node): void {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text === "@opentelemetry/api"
        ) {
          violations.push(`${getLocation(sourceFile, node)} imports OTel API directly`);
        }

        if (
          ts.isPropertyAssignment(node) &&
          getPropertyNameText(node.name) === "metricName" &&
          filePath !== schemaFile
        ) {
          violations.push(`${getLocation(sourceFile, node)} writes observability metricName`);
        }

        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const methodName = node.expression.name.text;

          if (
            methodName === "getMeter" ||
            methodName === "getTracer" ||
            methodName === "createCounter" ||
            methodName === "createHistogram" ||
            methodName === "createObservableGauge" ||
            methodName === "startSpan" ||
            methodName === "startActiveSpan"
          ) {
            violations.push(
              `${getLocation(sourceFile, node)} creates or resolves OTel telemetry directly`,
            );
          }
        }

        if (
          (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
          (forbiddenMetricLiterals.has(node.text) || metricNamespacePattern.test(node.text))
        ) {
          violations.push(
            `${getLocation(sourceFile, node)} names an observability metric directly`,
          );
        }

        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
