import type { InferInsertModel } from "drizzle-orm";
import { metrics, type Counter, type Meter, type MetricAttributes } from "@opentelemetry/api";

import { observabilityEvents } from "@/db/schema";

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

export type RunStartedMeter = Pick<Meter, "createCounter">;

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
