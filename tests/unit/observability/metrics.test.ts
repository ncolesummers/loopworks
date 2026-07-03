/** @vitest-environment node */
import {
  observabilityMetricNames,
  recordDevelopmentLoopRunStartedMetric,
} from "@/lib/observability/metrics";

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
});
