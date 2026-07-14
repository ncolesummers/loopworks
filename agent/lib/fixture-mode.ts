import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type StageFixtureMode =
  | { enabled: true; reason: "explicit_non_production_fixture" }
  | { enabled: false; reason: "not_requested" | "production_runtime_blocked" };

export function resolveStageFixtureMode(
  envVarName: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): StageFixtureMode {
  if (!isTruthyEnvValue(env[envVarName])) {
    return { enabled: false, reason: "not_requested" };
  }
  if (isProductionRuntime(env)) {
    return { enabled: false, reason: "production_runtime_blocked" };
  }
  return { enabled: true, reason: "explicit_non_production_fixture" };
}

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
  const mode = resolveStageFixtureMode("LOOPWORKS_EVE_FIXTURE_MODE", env);
  return mode.enabled ? { ...mode, label: "fixture" } : mode;
}
