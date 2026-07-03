import { metrics, type Counter, type Meter, type MetricAttributes } from "@opentelemetry/api";

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

export const developmentLoopRunCreatedDurableMetricName = "development_loop_run_created";

const loopworksMeterName = "loopworks";
const runStartedCounters = new WeakMap<object, Counter<MetricAttributes>>();

type RunStartedMeter = Pick<Meter, "createCounter">;

export function getLoopworksMeter(): Meter {
  return metrics.getMeter(loopworksMeterName);
}

function getRunStartedCounter(meter: RunStartedMeter): Counter<MetricAttributes> {
  const cached = runStartedCounters.get(meter);
  if (cached) {
    return cached;
  }

  const counter = meter.createCounter("loopworks.run.started", {
    description: "Development and workflow runs started by Loopworks.",
    unit: "{run}",
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
