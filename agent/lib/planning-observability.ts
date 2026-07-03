import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

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
  event: string;
  issueNumber?: number;
  rawIssueBody?: string;
  rawPrompt?: string;
  rawToolOutput?: string;
  repositoryFullName?: string;
  runId?: string;
  step?: string;
  traceId?: string;
};

export type PlanningAgentLogFields = {
  agent: string;
  event: string;
  issue?: number;
  repo?: string;
  run?: string;
  step?: string;
  traceId?: string;
};

export function resolvePlanningAgentTelemetryPolicy(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): PlanningAgentTelemetryPolicy {
  const requestedRawCapture = isTruthyEnvValue(env.LOOPWORKS_EVE_CAPTURE_IO);

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
    event: input.event,
    ...(input.issueNumber === undefined ? {} : { issue: input.issueNumber }),
    ...(input.repositoryFullName === undefined ? {} : { repo: input.repositoryFullName }),
    ...(input.runId === undefined ? {} : { run: input.runId }),
    ...(input.step === undefined ? {} : { step: input.step }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
  };
}
