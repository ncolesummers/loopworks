/** @vitest-environment node */
import {
  buildPlanningAgentLogFields,
  resolvePlanningAgentTelemetryPolicy,
} from "@agent/lib/planning-observability";

describe("Planning agent observability policy", () => {
  it("keeps production structured logs on while blocking raw IO capture", () => {
    expect(
      resolvePlanningAgentTelemetryPolicy({
        LOOPWORKS_EVE_CAPTURE_IO: "true",
        NODE_ENV: "production",
      }),
    ).toEqual({
      captureRawIO: false,
      recordInputs: false,
      recordOutputs: false,
      structuredLogs: true,
      reason: "production_raw_io_capture_blocked",
    });
  });

  it("allows raw IO capture only with non-production opt-in", () => {
    expect(
      resolvePlanningAgentTelemetryPolicy({
        LOOPWORKS_EVE_CAPTURE_IO: "true",
        NODE_ENV: "development",
      }),
    ).toMatchObject({
      captureRawIO: true,
      recordInputs: true,
      recordOutputs: true,
      structuredLogs: true,
    });
  });

  it("builds sanitized correlation fields without raw prompts or tool output", () => {
    const fields = buildPlanningAgentLogFields({
      agent: "planning-agent",
      event: "planning_tool_completed",
      issueNumber: 13,
      rawIssueBody: "secret raw issue body",
      rawPrompt: "secret raw prompt",
      rawToolOutput: "secret raw tool output",
      repositoryFullName: "ncolesummers/loopworks",
      runId: "run_123",
      step: "read_issue_context",
      traceId: "trace_123",
    });

    expect(fields).toEqual({
      agent: "planning-agent",
      event: "planning_tool_completed",
      issue: 13,
      repo: "ncolesummers/loopworks",
      run: "run_123",
      step: "read_issue_context",
      traceId: "trace_123",
    });
    expect(JSON.stringify(fields)).not.toContain("secret raw");
  });
});
