import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type ImplementerFixtureMode =
  | { enabled: true; reason: "explicit_non_production_fixture" }
  | { enabled: false; reason: "not_requested" | "production_runtime_blocked" };

export function resolveImplementerFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ImplementerFixtureMode {
  if (!isTruthyEnvValue(env.LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE)) {
    return { enabled: false, reason: "not_requested" };
  }
  if (isProductionRuntime(env)) {
    return { enabled: false, reason: "production_runtime_blocked" };
  }
  return { enabled: true, reason: "explicit_non_production_fixture" };
}
