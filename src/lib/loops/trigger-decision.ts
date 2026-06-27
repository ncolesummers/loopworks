import type { LoopRegistryItem } from "@/lib/types";

export type LoopTriggerDecision =
  | {
      shouldTrigger: true;
      reason: "ready";
      skipped: false;
    }
  | {
      shouldTrigger: false;
      reason: "loop_disabled";
      skipped: true;
    };

export function evaluateLoopTriggerDecision(input: {
  loop: Pick<LoopRegistryItem, "enabled">;
  trigger: string;
}): LoopTriggerDecision {
  if (!input.loop.enabled) {
    return {
      shouldTrigger: false,
      reason: "loop_disabled",
      skipped: true,
    };
  }

  return {
    shouldTrigger: true,
    reason: "ready",
    skipped: false,
  };
}
