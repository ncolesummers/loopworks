import { isProductionRuntime, isTruthyEnvValue } from "@/lib/runtime";

export type TestWriterFixtureMode =
  | { enabled: true; reason: "explicit_non_production_fixture" }
  | {
      enabled: false;
      reason: "not_requested" | "production_runtime_blocked";
    };

export function resolveTestWriterFixtureMode(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): TestWriterFixtureMode {
  if (!isTruthyEnvValue(env.LOOPWORKS_EVE_TEST_WRITER_FIXTURE_MODE)) {
    return { enabled: false, reason: "not_requested" };
  }
  if (isProductionRuntime(env)) {
    return { enabled: false, reason: "production_runtime_blocked" };
  }
  return { enabled: true, reason: "explicit_non_production_fixture" };
}
