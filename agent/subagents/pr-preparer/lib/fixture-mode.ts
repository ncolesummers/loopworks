import { resolveStageFixtureMode, type StageFixtureMode } from "../../../lib/fixture-mode";

export type PrPreparerFixtureMode = StageFixtureMode;

export function resolvePrPreparerFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): PrPreparerFixtureMode {
  return resolveStageFixtureMode("LOOPWORKS_EVE_PR_PREPARER_FIXTURE_MODE", env);
}
