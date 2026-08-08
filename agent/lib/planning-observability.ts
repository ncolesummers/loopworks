import { readBooleanConfig } from "@/lib/config/registry";
import { logger } from "@/lib/observability/logger";
import {
  recordPlanningToolDurationMetric,
  recordPlanningToolOutcomeMetric,
} from "@/lib/observability/metrics";
import {
  markLoopworksSpanError,
  markLoopworksSpanOk,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";
import { isProductionRuntime } from "@/lib/runtime";

export type PlanningAgentTelemetryPolicy = {
  captureRawIO: boolean;
  recordInputs: boolean;
  recordOutputs: boolean;
  reason:
    | "default_sanitized_metadata"
    | "non_production_raw_io_opt_in"
    | "production_raw_io_capture_blocked";
  structuredLogs: true;
};

export type PlanningAgentLogInput = {
  agent: string;
  count?: number;
  durationMs?: number;
  event: string;
  issueNumber?: number;
  outcome?: "error" | "success";
  provider?: string;
  rawIssueBody?: string;
  rawPrompt?: string;
  rawToolOutput?: string;
  repositoryFullName?: string;
  runId?: string;
  step?: string;
  tool?: string;
  traceId?: string;
};

export type PlanningAgentLogFields = {
  agent: string;
  count?: number;
  durationMs?: number;
  event: string;
  issue?: number;
  outcome?: "error" | "success";
  provider?: string;
  repo?: string;
  run?: string;
  step?: string;
  tool?: string;
  traceId?: string;
};

export function resolvePlanningAgentTelemetryPolicy(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): PlanningAgentTelemetryPolicy {
  const requestedRawCapture = readBooleanConfig("LOOPWORKS_EVE_CAPTURE_IO", env);

  if (requestedRawCapture && isProductionRuntime(env)) {
    return {
      captureRawIO: false,
      recordInputs: false,
      recordOutputs: false,
      reason: "production_raw_io_capture_blocked",
      structuredLogs: true,
    };
  }

  if (requestedRawCapture) {
    return {
      captureRawIO: true,
      recordInputs: true,
      recordOutputs: true,
      reason: "non_production_raw_io_opt_in",
      structuredLogs: true,
    };
  }

  return {
    captureRawIO: false,
    recordInputs: false,
    recordOutputs: false,
    reason: "default_sanitized_metadata",
    structuredLogs: true,
  };
}

export function buildPlanningAgentLogFields(input: PlanningAgentLogInput): PlanningAgentLogFields {
  return {
    agent: input.agent,
    ...(input.count === undefined ? {} : { count: input.count }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    event: input.event,
    ...(input.issueNumber === undefined ? {} : { issue: input.issueNumber }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.repositoryFullName === undefined ? {} : { repo: input.repositoryFullName }),
    ...(input.runId === undefined ? {} : { run: input.runId }),
    ...(input.step === undefined ? {} : { step: input.step }),
    ...(input.tool === undefined ? {} : { tool: input.tool }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  };
}

export type PlanningToolObservationInput = {
  issueNumber?: number;
  provider: string;
  repositoryFullName?: string;
  runId: string;
  tool: string;
};

export type PlanningToolObservation = {
  bind(input: { issueNumber?: number; repositoryFullName: string }): void;
  fail(error: unknown): void;
  succeed(input: { count: number; truncated: boolean }): void;
};

export function startPlanningToolObservation(
  input: PlanningToolObservationInput,
): PlanningToolObservation {
  const startedAt = performance.now();
  let issueNumber = input.issueNumber;
  let repositoryFullName = input.repositoryFullName;
  const span = startLoopworksSpan("loopworks.agent.tool", {
    attributes: {
      "loopworks.agent": "planner",
      "loopworks.github.issue.number": issueNumber,
      "loopworks.provider": input.provider,
      "loopworks.repository": repositoryFullName,
      "loopworks.run.id": input.runId,
      "loopworks.tool": input.tool,
    },
  });
  let ended = false;

  const finish = (outcome: "error" | "success", count: number, truncated: boolean) => {
    if (ended) return;
    ended = true;
    const durationMs = Math.max(0, performance.now() - startedAt);
    const metric = {
      agent: "planner",
      outcome,
      provider: input.provider,
      tool: input.tool,
    } as const;
    recordPlanningToolOutcomeMetric(metric);
    recordPlanningToolDurationMetric({ ...metric, durationSeconds: durationMs / 1_000 });
    span.setAttributes({
      "loopworks.result.count": count,
      "loopworks.result.truncated": truncated,
      "loopworks.tool.outcome": outcome,
    });
    const fields = buildPlanningAgentLogFields({
      agent: "planner",
      count,
      durationMs,
      event: "planning_tool_completed",
      issueNumber,
      outcome,
      provider: input.provider,
      repositoryFullName,
      runId: input.runId,
      tool: input.tool,
    });
    if (outcome === "success") logger.info(fields, "Planning tool completed");
    else logger.warn(fields, "Planning tool failed");
    span.end();
  };

  return {
    bind(input) {
      issueNumber = input.issueNumber;
      repositoryFullName = input.repositoryFullName;
      span.setAttributes({
        "loopworks.github.issue.number": issueNumber,
        "loopworks.repository": repositoryFullName,
      });
    },
    fail(error) {
      markLoopworksSpanError(span, error);
      finish("error", 0, false);
    },
    succeed({ count, truncated }) {
      markLoopworksSpanOk(span);
      finish("success", count, truncated);
    },
  };
}
