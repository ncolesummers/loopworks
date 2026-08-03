import type { PortalRecordsResult } from "@/lib/portal/records";

export type FirstRunStage = "no-repositories" | "no-loops";

export type FirstRunState =
  | {
      hasRunActivity?: never;
      reason: string;
      stage?: never;
      status: "unavailable";
    }
  | {
      hasRunActivity?: never;
      reason?: never;
      stage: FirstRunStage;
      status: "onboarding";
    }
  | {
      /** Reads one preferred run's timeline steps; not a run count, and runs with no steps read false. */
      hasRunActivity: boolean;
      reason?: never;
      stage?: never;
      status: "activated";
    };

export function deriveFirstRunState(input: { result: PortalRecordsResult }): FirstRunState {
  if (input.result.source === "unavailable") {
    return { reason: input.result.error, status: "unavailable" };
  }

  if (input.result.records.repos.length === 0) {
    return { stage: "no-repositories", status: "onboarding" };
  }

  if (input.result.records.loops.length === 0) {
    return { stage: "no-loops", status: "onboarding" };
  }

  return {
    hasRunActivity: input.result.records.timeline.length > 0,
    status: "activated",
  };
}
