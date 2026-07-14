import { resolveStageFixtureMode, type StageFixtureMode } from "../../../lib/fixture-mode";

export type ImplementerFixtureMode = StageFixtureMode;

export function resolveImplementerFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ImplementerFixtureMode {
  return resolveStageFixtureMode("LOOPWORKS_EVE_IMPLEMENTER_FIXTURE_MODE", env);
}
