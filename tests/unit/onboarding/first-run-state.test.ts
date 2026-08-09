/** @vitest-environment node */

import { portalFixture } from "@/lib/fixtures";
import {
  deriveFirstRunState,
  type FirstRunStage,
  type FirstRunState,
  isFirstRunActivated,
  isFirstRunOnboarding,
  isFirstRunUnavailable,
} from "@/lib/onboarding/first-run-state";
import type { PortalRecords, PortalRecordsResult } from "@/lib/portal/records";

type PortalResultInput = {
  error?: string;
  githubInstallations?: PortalRecords["githubInstallations"];
  loops?: PortalRecords["loops"];
  registeredLoops?: PortalRecords["registeredLoops"];
  repos?: PortalRecords["repos"];
  source?: PortalRecordsResult["source"];
  timeline?: PortalRecords["timeline"];
};

function portalRecordsResult(input: PortalResultInput = {}): PortalRecordsResult {
  const records: PortalRecords = {
    approval: portalFixture.approval,
    artifacts: portalFixture.artifacts,
    deployments: portalFixture.deployments,
    githubInstallations: input.githubInstallations ?? [
      {
        accountLogin: "loopworks-org",
        accountType: "Organization",
        installationId: 124_001,
        repositorySelection: "selected",
      },
    ],
    githubSettings: portalFixture.githubSettings,
    loops: input.loops ?? portalFixture.loops.slice(0, 1),
    registeredLoops: input.registeredLoops ?? portalFixture.registeredLoops.slice(0, 1),
    repos: input.repos ?? portalFixture.repos.slice(0, 1),
    timeline: input.timeline ?? portalFixture.timeline,
    validationResults: portalFixture.validationResults,
  };
  const source = input.source ?? "db";

  if (source === "fixtures") {
    return {
      fallbackReason: "test_fixture",
      records,
      source,
      usedFallback: true,
    };
  }

  if (source === "unavailable") {
    return {
      error: input.error ?? "Portal data store unavailable.",
      records,
      source,
      usedFallback: false,
    };
  }

  return {
    records,
    source,
    usedFallback: false,
  };
}

function firstRunState(state: FirstRunState): FirstRunState {
  return state;
}

describe("deriveFirstRunState", () => {
  it("returns no-installation before inspecting repositories or loops", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ githubInstallations: [] }),
    });

    expect(state).toEqual({
      stage: "no-installation",
      status: "onboarding",
    });
  });

  it("returns no-repositories onboarding when no repositories exist", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ loops: [], repos: [], timeline: [] }),
    });

    expect(state).toEqual({
      stage: "no-repositories",
      status: "onboarding",
    });
  });

  it("returns no-loops onboarding when a repository has no registered loops", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ registeredLoops: [], timeline: [] }),
    });

    expect(state).toEqual({
      stage: "no-loops",
      status: "onboarding",
    });
  });

  it("stays in no-loops while only synced issue loops exist", () => {
    // Activation completes at a registered loop contract (#126). Issue rows arrive from webhook
    // sync and say nothing about whether the operator ever registered a loop.
    const state = deriveFirstRunState({
      result: portalRecordsResult({
        loops: portalFixture.loops,
        registeredLoops: [],
        timeline: [],
      }),
    });

    expect(state).toEqual({
      stage: "no-loops",
      status: "onboarding",
    });
  });

  it("activates on a registered loop even before any issue has synced", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ loops: [], timeline: [] }),
    });

    expect(state).toEqual({
      hasRunActivity: false,
      status: "activated",
    });
  });

  it("returns activated with run activity when the timeline is populated", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ timeline: portalFixture.timeline }),
    });

    expect(state).toEqual({
      hasRunActivity: true,
      status: "activated",
    });
  });

  it("returns activated without run activity when the timeline is empty", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ timeline: [] }),
    });

    expect(state).toEqual({
      hasRunActivity: false,
      status: "activated",
    });
  });

  it("carries the exact unavailable error through as the reason", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({
        error: "Database read failed exactly once.",
        source: "unavailable",
      }),
    });

    expect(state).toEqual({
      reason: "Database read failed exactly once.",
      status: "unavailable",
    });
  });

  it("crosses from activated to no-repositories when repository count changes from one to zero", () => {
    const withRepository = deriveFirstRunState({
      result: portalRecordsResult({ timeline: [] }),
    });
    const withoutRepository = deriveFirstRunState({
      result: portalRecordsResult({ loops: [], repos: [], timeline: [] }),
    });

    expect(withRepository).toEqual({
      hasRunActivity: false,
      status: "activated",
    });
    expect(withoutRepository).toEqual({
      stage: "no-repositories",
      status: "onboarding",
    });
  });

  it("crosses from activated to no-loops when registered loop count changes from one to zero", () => {
    const withLoop = deriveFirstRunState({
      result: portalRecordsResult({ timeline: [] }),
    });
    const withoutLoop = deriveFirstRunState({
      result: portalRecordsResult({ registeredLoops: [], timeline: [] }),
    });

    expect(withLoop).toEqual({
      hasRunActivity: false,
      status: "activated",
    });
    expect(withoutLoop).toEqual({
      stage: "no-loops",
      status: "onboarding",
    });
  });

  it("short-circuits unavailable before inspecting fully populated records", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({
        error: "Production database unavailable.",
        source: "unavailable",
      }),
    });

    expect(state).toEqual({
      reason: "Production database unavailable.",
      status: "unavailable",
    });
  });

  it("computes activated state for fully populated fixture records", () => {
    const state = deriveFirstRunState({
      result: portalRecordsResult({ source: "fixtures" }),
    });

    expect(state).toEqual({
      hasRunActivity: true,
      status: "activated",
    });
  });

  it("rejects an onboarding state carrying an unavailable reason from a non-fresh value", () => {
    const conflated = {
      reason: "boom",
      stage: "no-loops",
      status: "onboarding",
    } as const;

    // This value is non-fresh on purpose: without the `?: never` exclusions, the
    // following @ts-expect-error becomes unused and typecheck fails.
    // @ts-expect-error -- The onboarding arm must not admit an unavailable reason.
    const rejected: FirstRunState = conflated;

    expect(rejected).toBe(conflated);
  });

  it("rejects an unavailable state carrying an onboarding stage from a non-fresh value", () => {
    const conflated = {
      reason: "boom",
      stage: "no-loops",
      status: "unavailable",
    } as const;

    // This value is non-fresh on purpose: without the `?: never` exclusions, the
    // following @ts-expect-error becomes unused and typecheck fails.
    // @ts-expect-error -- The unavailable arm must not admit an onboarding stage.
    const rejected: FirstRunState = conflated;

    expect(rejected).toBe(conflated);
  });
});

describe("FirstRunState guards", () => {
  const activated = firstRunState({
    hasRunActivity: true,
    status: "activated",
  });
  const onboarding = firstRunState({
    stage: "no-loops",
    status: "onboarding",
  });
  const unavailable = firstRunState({
    reason: "Portal data store unavailable.",
    status: "unavailable",
  });

  it("identifies and narrows the unavailable arm", () => {
    expect(isFirstRunUnavailable(unavailable)).toBe(true);
    expect(isFirstRunUnavailable(onboarding)).toBe(false);
    expect(isFirstRunUnavailable(activated)).toBe(false);

    if (isFirstRunUnavailable(unavailable)) {
      const reason: string = unavailable.reason;

      expect(reason).toBe("Portal data store unavailable.");
    }
  });

  it("identifies and narrows the onboarding arm", () => {
    expect(isFirstRunOnboarding(onboarding)).toBe(true);
    expect(isFirstRunOnboarding(unavailable)).toBe(false);
    expect(isFirstRunOnboarding(activated)).toBe(false);

    if (isFirstRunOnboarding(onboarding)) {
      const stage: FirstRunStage = onboarding.stage;

      expect(stage).toBe("no-loops");
    }
  });

  it("identifies and narrows the activated arm", () => {
    expect(isFirstRunActivated(activated)).toBe(true);
    expect(isFirstRunActivated(unavailable)).toBe(false);
    expect(isFirstRunActivated(onboarding)).toBe(false);

    if (isFirstRunActivated(activated)) {
      const hasRunActivity: boolean = activated.hasRunActivity;

      expect(hasRunActivity).toBe(true);
    }
  });

  it("documents that property-presence narrowing is unsafe without exactOptionalPropertyTypes", () => {
    const conflated = {
      reason: undefined,
      stage: "no-loops" as const,
      status: "onboarding" as const,
    };

    // Follow-up: see ADR 0019's repo-wide exactOptionalPropertyTypes migration item.
    const accepted: FirstRunState = conflated;

    expect("reason" in accepted).toBe(true);
    expect(isFirstRunOnboarding(accepted)).toBe(true);
    expect(accepted.reason).toBeUndefined();
  });
});
