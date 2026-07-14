import { resolveStageFixtureMode, type StageFixtureMode } from "../../../lib/fixture-mode";

export type TestWriterFixtureMode = StageFixtureMode;

export function resolveTestWriterFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TestWriterFixtureMode {
  return resolveStageFixtureMode("LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE", env);
}
