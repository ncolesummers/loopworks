import { resolveStageFixtureMode, type StageFixtureMode } from "../../../lib/fixture-mode";

export type ValidationReviewerFixtureMode = StageFixtureMode;

export function resolveValidationReviewerFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): ValidationReviewerFixtureMode {
  return resolveStageFixtureMode("LOOPWORKS_EVE_VALIDATION_REVIEWER_FIXTURE_MODE", env);
}
