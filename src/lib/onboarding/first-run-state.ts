import type { PortalRecordsResult } from "@/lib/portal/records";

export type FirstRunStage = "no-repositories" | "no-loops";

/**
 * `status` is the only safe discriminant; always narrow on it or with the guards below.
 * Property-presence checks such as `"reason" in state` are unsafe: without
 * exactOptionalPropertyTypes, an onboarding value may include `reason: undefined`,
 * making the `in` check true. The `?: never` exclusions still reject conflated
 * values with a real (non-undefined) reason or stage.
 */
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

export function isFirstRunUnavailable(
  state: FirstRunState,
): state is Extract<FirstRunState, { status: "unavailable" }> {
  return state.status === "unavailable";
}

export function isFirstRunOnboarding(
  state: FirstRunState,
): state is Extract<FirstRunState, { status: "onboarding" }> {
  return state.status === "onboarding";
}

export function isFirstRunActivated(
  state: FirstRunState,
): state is Extract<FirstRunState, { status: "activated" }> {
  return state.status === "activated";
}

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
