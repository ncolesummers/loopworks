import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type PlanningAgentFixtureMode =
  | {
      enabled: true;
      label: "fixture";
      reason: "explicit_non_production_fixture";
    }
  | {
      enabled: false;
      reason: "not_requested" | "production_runtime_blocked";
    };

export function resolvePlanningAgentFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): PlanningAgentFixtureMode {
  if (!isTruthyEnvValue(env.LOOPWORKS_EVE_FIXTURE_MODE)) {
    return {
      enabled: false,
      reason: "not_requested",
    };
  }

  if (isProductionRuntime(env)) {
    return {
      enabled: false,
      reason: "production_runtime_blocked",
    };
  }

  return {
    enabled: true,
    label: "fixture",
    reason: "explicit_non_production_fixture",
  };
}
