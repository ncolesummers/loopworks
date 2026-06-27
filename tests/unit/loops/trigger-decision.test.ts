import { evaluateLoopTriggerDecision } from "@/lib/loops/trigger-decision";
import type { LoopRegistryItem } from "@/lib/types";

const enabledLoop: LoopRegistryItem = {
  name: "Implementation routing",
  state: "In Progress",
  enabled: true,
  owner: "Morgan",
  queueDepth: 7,
  risk: "medium",
};

describe("loop trigger decisions", () => {
  it("records a skipped reason before a disabled loop can trigger", () => {
    expect(
      evaluateLoopTriggerDecision({
        loop: {
          ...enabledLoop,
          enabled: false,
        },
        trigger: "agent-ready",
      }),
    ).toEqual({
      shouldTrigger: false,
      reason: "loop_disabled",
      skipped: true,
    });
  });

  it("allows enabled loops to trigger", () => {
    expect(
      evaluateLoopTriggerDecision({
        loop: enabledLoop,
        trigger: "agent-ready",
      }),
    ).toEqual({
      shouldTrigger: true,
      reason: "ready",
      skipped: false,
    });
  });
});
