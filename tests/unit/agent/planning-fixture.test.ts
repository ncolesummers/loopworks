/** @vitest-environment node */
import { resolvePlanningAgentFixtureMode } from "@agent/lib/fixture-mode";

describe("Planning agent fixture mode", () => {
  it("stays disabled unless explicitly requested", () => {
    expect(resolvePlanningAgentFixtureMode({})).toEqual({
      enabled: false,
      reason: "not_requested",
    });
  });

  it("enables explicit fixture mode only outside production", () => {
    expect(
      resolvePlanningAgentFixtureMode({
        LOOPWORKS_EVE_FIXTURE_MODE: "true",
        NODE_ENV: "development",
      }),
    ).toEqual({
      enabled: true,
      label: "fixture",
      reason: "explicit_non_production_fixture",
    });
  });

  it("fails closed in production-like runtimes", () => {
    expect(
      resolvePlanningAgentFixtureMode({
        LOOPWORKS_EVE_FIXTURE_MODE: "true",
        VERCEL_ENV: "production",
      }),
    ).toEqual({
      enabled: false,
      reason: "production_runtime_blocked",
    });
  });
});
