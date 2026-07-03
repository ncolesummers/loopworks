import { defineInstrumentation } from "eve/instrumentation";

import { resolvePlanningAgentTelemetryPolicy } from "./lib/planning-observability";

const telemetryPolicy = resolvePlanningAgentTelemetryPolicy();

export default defineInstrumentation({
  recordInputs: telemetryPolicy.recordInputs,
  recordOutputs: telemetryPolicy.recordOutputs,
  events: {
    "step.started"(input) {
      return {
        runtimeContext: {
          "loopworks.agent": "planning-agent",
          "loopworks.telemetry.policy": telemetryPolicy.reason,
          "loopworks.raw_io_capture": telemetryPolicy.captureRawIO,
          "loopworks.session.id": input.session.id,
          "loopworks.step.index": input.step.index,
          "loopworks.turn.id": input.turn.id,
        },
      };
    },
  },
});
