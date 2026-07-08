import {
  type Counter,
  type Histogram,
  type Meter,
  type MetricAttributes,
  metrics,
  type ObservableGauge,
} from "@opentelemetry/api";
import { count, eq, type InferInsertModel } from "drizzle-orm";

import type { db } from "@/db/client";
import { approvals, loopRuns, observabilityEvents } from "@/db/schema";

export type ObservabilityMetricInstrument = "counter" | "histogram" | "observable_gauge";

export type ObservabilityMetricDefinition = {
  instrument: ObservabilityMetricInstrument;
  name: string;
  requiredAttributes: readonly string[];
  unit: string;
};

export const observabilityMetricContract = [
  {
    instrument: "counter",
    name: "loopworks.run.started",
    requiredAttributes: ["loop.key", "repository", "trigger.label"],
    unit: "{run}",
  },
  {
    instrument: "counter",
    name: "loopworks.run.completed",
    requiredAttributes: ["loop.key", "repository", "status"],
    unit: "{run}",
  },
  {
    instrument: "histogram",
    name: "loopworks.run.duration",
    requiredAttributes: ["loop.key", "status"],
    unit: "s",
  },
  {
    instrument: "histogram",
    name: "loopworks.step.duration",
    requiredAttributes: ["loop.key", "stage", "status"],
    unit: "s",
  },
  {
    instrument: "counter",
    name: "loopworks.step.retries",
    requiredAttributes: ["loop.key", "stage", "reason"],
    unit: "{retry}",
  },
  {
    instrument: "counter",
    name: "loopworks.validation.outcome",
    requiredAttributes: ["gate", "command", "status"],
    unit: "{check}",
  },
  {
    instrument: "histogram",
    name: "loopworks.validation.duration",
    requiredAttributes: ["gate", "command"],
    unit: "s",
  },
  {
    instrument: "counter",
    name: "loopworks.webhook.outcome",
    requiredAttributes: ["event", "action", "outcome"],
    unit: "{delivery}",
  },
  {
    instrument: "counter",
    name: "loopworks.deployment.observed",
    requiredAttributes: ["environment", "status"],
    unit: "{deployment}",
  },
  {
    instrument: "histogram",
    name: "loopworks.approval.wait_time",
    requiredAttributes: ["gate", "decision"],
    unit: "s",
  },
  {
    instrument: "observable_gauge",
    name: "loopworks.approval.pending",
    requiredAttributes: ["gate"],
    unit: "{approval}",
  },
  {
    instrument: "observable_gauge",
    name: "loopworks.queue.depth",
    requiredAttributes: ["loop.key"],
    unit: "{run}",
  },
  {
    instrument: "counter",
    name: "loopworks.lock.contention",
    requiredAttributes: ["scope"],
    unit: "{conflict}",
  },
  {
    instrument: "counter",
    name: "loopworks.model.requests",
    requiredAttributes: ["model", "provider", "agent", "outcome"],
    unit: "{request}",
  },
  {
    instrument: "counter",
    name: "loopworks.model.tokens",
    requiredAttributes: ["model", "provider", "agent", "direction"],
    unit: "{token}",
  },
  {
    instrument: "counter",
    name: "loopworks.model.cost",
    requiredAttributes: ["model", "provider", "agent"],
    unit: "USD",
  },
] as const satisfies readonly ObservabilityMetricDefinition[];

export const observabilityMetricNames = observabilityMetricContract.map((metric) => metric.name);

export type ObservabilityMetricName = (typeof observabilityMetricContract)[number]["name"];

const observabilityMetricDefinitions = new Map(
  observabilityMetricContract.map((metric) => [metric.name, metric]),
);

export function resolveObservabilityMetricDefinition(
  name: string,
): (typeof observabilityMetricContract)[number] {
  const metric = observabilityMetricDefinitions.get(name as ObservabilityMetricName);

  if (!metric) {
    throw new Error(`Unsupported Loopworks observability metric name: ${name}`);
  }

  return metric;
}

export const developmentLoopRunCreatedEventType = "development_loop_run_created";
export const developmentLoopRunCreatedDurableMetricName = developmentLoopRunCreatedEventType;

export type DurableObservabilityEventDefinition = {
  eventType: string;
  metricName: string;
  otelMetricName: ObservabilityMetricName;
};

export const durableObservabilityEventContract = [
  {
    eventType: developmentLoopRunCreatedEventType,
    metricName: developmentLoopRunCreatedDurableMetricName,
    otelMetricName: "loopworks.run.started",
  },
] as const satisfies readonly DurableObservabilityEventDefinition[];

export type DurableObservabilityEventMetricName =
  (typeof durableObservabilityEventContract)[number]["metricName"];

const durableObservabilityEventsByMetricName = new Map(
  durableObservabilityEventContract.map((event) => [event.metricName, event]),
);

export function resolveDurableObservabilityEventDefinition(
  metricName: string,
): (typeof durableObservabilityEventContract)[number] {
  const event = durableObservabilityEventsByMetricName.get(
    metricName as DurableObservabilityEventMetricName,
  );

  if (!event) {
    throw new Error(`Unsupported durable observability event metric name: ${metricName}`);
  }

  return event;
}

const loopworksMeterName = "loopworks";
const runStartedCounters = new WeakMap<object, Counter<MetricAttributes>>();
const webhookOutcomeCounters = new WeakMap<object, Counter<MetricAttributes>>();
const approvalWaitTimeHistograms = new WeakMap<object, Histogram<MetricAttributes>>();
const lockContentionCounters = new WeakMap<object, Counter<MetricAttributes>>();
const approvalPendingGauges = new WeakMap<object, ObservableGauge<MetricAttributes>>();
const queueDepthGauges = new WeakMap<object, ObservableGauge<MetricAttributes>>();
const controlPlaneGaugeSourcesByMeter = new WeakMap<object, ControlPlaneGaugeSources>();
const supportedGithubWebhookMetricEvents = new Set(["issues", "unknown", "unsupported"]);

export type RunStartedMeter = Pick<Meter, "createCounter">;
export type CounterMeter = Pick<Meter, "createCounter">;
export type HistogramMeter = Pick<Meter, "createHistogram">;
export type ObservableGaugeMeter = Pick<Meter, "createObservableGauge">;

export type GithubWebhookOutcome =
  | "accepted"
  | "rejected"
  | "duplicate"
  | "invalid_signature"
  | "error";

export type GithubWebhookOutcomeMetricInput = {
  action?: string | null;
  event: string;
  outcome: GithubWebhookOutcome;
};

export type ApprovalWaitTimeMetricInput = {
  decision: "approved" | "rejected" | "expired" | "bypassed";
  durationSeconds: number;
  gate: string;
};

export type LockContentionMetricInput = {
  scope: string;
};

export type ControlPlanePendingApprovalMeasurement = {
  gate: string;
  value: number;
};

export type ControlPlaneQueuedRunMeasurement = {
  loopKey: string;
  value: number;
};

export type ControlPlaneGaugeMeasurements = {
  pendingApprovals: ControlPlanePendingApprovalMeasurement[];
  queuedRuns: ControlPlaneQueuedRunMeasurement[];
};

export type ControlPlaneGaugeSources = {
  pendingApprovals: () =>
    | ControlPlanePendingApprovalMeasurement[]
    | Promise<ControlPlanePendingApprovalMeasurement[]>;
  queuedRuns: () =>
    | ControlPlaneQueuedRunMeasurement[]
    | Promise<ControlPlaneQueuedRunMeasurement[]>;
};

export type ControlPlaneGaugeDatabase = Pick<typeof db, "select">;

type ObservabilityEventInsert = InferInsertModel<typeof observabilityEvents>;

export type ObservabilityEventsWriter = {
  insert(table: typeof observabilityEvents): {
    values(row: ObservabilityEventInsert): Promise<unknown> | unknown;
  };
};

export function getLoopworksMeter(): Meter {
  return metrics.getMeter(loopworksMeterName);
}

function getRunStartedCounter(meter: RunStartedMeter): Counter<MetricAttributes> {
  const cached = runStartedCounters.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.run.started");
  const counter = meter.createCounter(metric.name, {
    description: "Development and workflow runs started by Loopworks.",
    unit: metric.unit,
  });
  runStartedCounters.set(meter, counter);
  return counter;
}

function getWebhookOutcomeCounter(meter: CounterMeter): Counter<MetricAttributes> {
  const cached = webhookOutcomeCounters.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.webhook.outcome");
  const counter = meter.createCounter(metric.name, {
    description: "GitHub webhook delivery outcomes at the Loopworks intake boundary.",
    unit: metric.unit,
  });
  webhookOutcomeCounters.set(meter, counter);
  return counter;
}

function getApprovalWaitTimeHistogram(meter: HistogramMeter): Histogram<MetricAttributes> {
  const cached = approvalWaitTimeHistograms.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.approval.wait_time");
  const histogram = meter.createHistogram(metric.name, {
    description: "Elapsed seconds between approval request and terminal decision.",
    unit: metric.unit,
  });
  approvalWaitTimeHistograms.set(meter, histogram);
  return histogram;
}

function getLockContentionCounter(meter: CounterMeter): Counter<MetricAttributes> {
  const cached = lockContentionCounters.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.lock.contention");
  const counter = meter.createCounter(metric.name, {
    description: "Idempotency lock conflicts observed by Loopworks control-plane paths.",
    unit: metric.unit,
  });
  lockContentionCounters.set(meter, counter);
  return counter;
}

function getApprovalPendingGauge(meter: ObservableGaugeMeter): ObservableGauge<MetricAttributes> {
  const cached = approvalPendingGauges.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.approval.pending");
  const gauge = meter.createObservableGauge(metric.name, {
    description: "Currently pending approvals by approval gate.",
    unit: metric.unit,
  });
  approvalPendingGauges.set(meter, gauge);
  return gauge;
}

function getQueueDepthGauge(meter: ObservableGaugeMeter): ObservableGauge<MetricAttributes> {
  const cached = queueDepthGauges.get(meter);
  if (cached) {
    return cached;
  }

  const metric = resolveObservabilityMetricDefinition("loopworks.queue.depth");
  const gauge = meter.createObservableGauge(metric.name, {
    description: "Queued loop runs by loop key.",
    unit: metric.unit,
  });
  queueDepthGauges.set(meter, gauge);
  return gauge;
}

function normalizeMetricAttribute(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || fallback;
}

function normalizeGithubWebhookEventAttribute(value: string): string {
  const normalized = normalizeMetricAttribute(value, "unknown");
  return supportedGithubWebhookMetricEvents.has(normalized) ? normalized : "unsupported";
}

export function recordDevelopmentLoopRunStartedMetric(
  input: {
    loopKey: string;
    repository: string;
    triggerLabel: string;
  },
  meter: RunStartedMeter = getLoopworksMeter(),
): void {
  getRunStartedCounter(meter).add(1, {
    "loop.key": input.loopKey,
    repository: input.repository,
    "trigger.label": input.triggerLabel,
  });
}

export function recordGithubWebhookOutcomeMetric(
  input: GithubWebhookOutcomeMetricInput,
  meter: CounterMeter = getLoopworksMeter(),
): void {
  try {
    getWebhookOutcomeCounter(meter).add(1, {
      action: normalizeMetricAttribute(input.action, "none"),
      event: normalizeGithubWebhookEventAttribute(input.event),
      outcome: input.outcome,
    });
  } catch {
    // OTel emission must never affect webhook request handling.
  }
}

export function recordApprovalWaitTimeMetric(
  input: ApprovalWaitTimeMetricInput,
  meter: HistogramMeter = getLoopworksMeter(),
): void {
  try {
    getApprovalWaitTimeHistogram(meter).record(Math.max(0, input.durationSeconds), {
      decision: input.decision,
      gate: normalizeMetricAttribute(input.gate, "unknown"),
    });
  } catch {
    // OTel emission must never affect approval state transitions.
  }
}

export function recordLockContentionMetric(
  input: LockContentionMetricInput,
  meter: CounterMeter = getLoopworksMeter(),
): void {
  try {
    getLockContentionCounter(meter).add(1, {
      scope: normalizeMetricAttribute(input.scope, "unknown"),
    });
  } catch {
    // OTel emission must never affect idempotency or queue semantics.
  }
}

export async function collectPendingApprovalGaugeMeasurements(
  database: ControlPlaneGaugeDatabase,
): Promise<ControlPlanePendingApprovalMeasurement[]> {
  const rows = await database
    .select({
      gate: approvals.scope,
      value: count(approvals.id),
    })
    .from(approvals)
    .where(eq(approvals.status, "requested"))
    .groupBy(approvals.scope);

  return rows.map((row) => ({
    gate: row.gate,
    value: Number(row.value),
  }));
}

export async function collectQueuedRunGaugeMeasurements(
  database: ControlPlaneGaugeDatabase,
): Promise<ControlPlaneQueuedRunMeasurement[]> {
  const rows = await database
    .select({
      loopKey: loopRuns.loopKey,
      value: count(loopRuns.id),
    })
    .from(loopRuns)
    .where(eq(loopRuns.status, "queued"))
    .groupBy(loopRuns.loopKey);

  return rows.map((row) => ({
    loopKey: row.loopKey,
    value: Number(row.value),
  }));
}

export async function collectControlPlaneGaugeMeasurements(
  database: ControlPlaneGaugeDatabase,
): Promise<ControlPlaneGaugeMeasurements> {
  const [pendingApprovals, queuedRuns] = await Promise.all([
    collectPendingApprovalGaugeMeasurements(database),
    collectQueuedRunGaugeMeasurements(database),
  ]);

  return {
    pendingApprovals,
    queuedRuns,
  };
}

export function createControlPlaneGaugeSources(
  database: ControlPlaneGaugeDatabase,
): ControlPlaneGaugeSources {
  return {
    pendingApprovals: () => collectPendingApprovalGaugeMeasurements(database),
    queuedRuns: () => collectQueuedRunGaugeMeasurements(database),
  };
}

export function registerControlPlaneGaugeMetrics(
  input: {
    sources: ControlPlaneGaugeSources;
  },
  meter: ObservableGaugeMeter = getLoopworksMeter(),
): void {
  controlPlaneGaugeSourcesByMeter.set(meter, input.sources);

  const approvalPendingGaugeAlreadyRegistered = approvalPendingGauges.has(meter);
  const approvalPendingGauge = getApprovalPendingGauge(meter);
  if (!approvalPendingGaugeAlreadyRegistered) {
    approvalPendingGauge.addCallback(async (result) => {
      try {
        const measurements = await controlPlaneGaugeSourcesByMeter.get(meter)?.pendingApprovals();
        for (const measurement of measurements ?? []) {
          result.observe(Math.max(0, measurement.value), {
            gate: normalizeMetricAttribute(measurement.gate, "unknown"),
          });
        }
      } catch {
        // Gauge collection must not throw into the OTel reader.
      }
    });
  }

  const queueDepthGaugeAlreadyRegistered = queueDepthGauges.has(meter);
  const queueDepthGauge = getQueueDepthGauge(meter);
  if (!queueDepthGaugeAlreadyRegistered) {
    queueDepthGauge.addCallback(async (result) => {
      try {
        const measurements = await controlPlaneGaugeSourcesByMeter.get(meter)?.queuedRuns();
        for (const measurement of measurements ?? []) {
          result.observe(Math.max(0, measurement.value), {
            "loop.key": normalizeMetricAttribute(measurement.loopKey, "unknown"),
          });
        }
      } catch {
        // Gauge collection must not throw into the OTel reader.
      }
    });
  }
}

export async function recordDevelopmentLoopRunCreatedObservability(input: {
  artifactCount: number;
  deliveryId?: string;
  issueNumber: number;
  loopKey: string;
  meter?: RunStartedMeter;
  repositoryFullName: string;
  repositoryId: string;
  runId: string;
  stageCount: number;
  traceId?: string;
  triggerLabel: string;
  writer: ObservabilityEventsWriter;
}): Promise<() => void> {
  const event = resolveDurableObservabilityEventDefinition(
    developmentLoopRunCreatedDurableMetricName,
  );

  await input.writer.insert(observabilityEvents).values({
    correlationId: input.deliveryId,
    eventType: event.eventType,
    message: "Agent-ready development loop run skeleton created.",
    metricName: event.metricName,
    metricValue: input.stageCount,
    payload: {
      artifactCount: input.artifactCount,
      issueNumber: input.issueNumber,
      loopKey: input.loopKey,
      repositoryFullName: input.repositoryFullName,
      stageCount: input.stageCount,
    },
    repositoryId: input.repositoryId,
    runId: input.runId,
    severity: "info",
    traceId: input.traceId,
  });

  return () => {
    try {
      recordDevelopmentLoopRunStartedMetric(
        {
          loopKey: input.loopKey,
          repository: input.repositoryFullName,
          triggerLabel: input.triggerLabel,
        },
        input.meter,
      );
    } catch {
      // Durable event persistence is the source of truth; OTel emission must not roll back runs.
    }
  };
}
