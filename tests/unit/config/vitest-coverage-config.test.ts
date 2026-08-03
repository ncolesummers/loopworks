import { describe, expect, it } from "vitest";

import vitestConfig from "../../../vitest.config";

/**
 * Coverage instrumentation is measurement-only today (#118); thresholds and the
 * CI wiring land in #120. These assertions pin the shape that later slice
 * inherits, so a narrowed `include` or a dropped reporter fails here rather
 * than silently skewing the audit in #119.
 */
const coverage = vitestConfig.test?.coverage;

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeDefined();
  return value as Record<string, unknown>;
}

describe("vitest coverage configuration", () => {
  it("uses the v8 provider and stays opt-in behind --coverage", () => {
    const config = asRecord(coverage);

    expect(config.provider).toBe("v8");
    expect(config.enabled).toBe(false);
    expect(config.reportsDirectory).toBe("./coverage");
  });

  it("emits the reporters the audit and CI slices consume", () => {
    const config = asRecord(coverage);

    expect(config.reporter).toEqual(expect.arrayContaining(["text", "lcov", "json-summary"]));
  });

  it("measures every src, agent, and scripts file even when untested", () => {
    const config = asRecord(coverage);
    const include = config.include as string[];

    // Vitest 4 reports every file matching `include`, tested or not, so these
    // globs are the whole contract: narrowing one silently drops untested files
    // from the report and flatters the baseline #119 ranks gaps from.
    expect(include).toEqual(
      expect.arrayContaining([
        "src/**/*.{ts,tsx}",
        "agent/**/*.{ts,tsx}",
        "scripts/**/*.{ts,tsx,mjs}",
      ]),
    );
  });

  it("excludes tests, generated output, and fixtures", () => {
    const config = asRecord(coverage);
    const exclude = config.exclude as string[];

    expect(exclude).toEqual(
      expect.arrayContaining([
        "**/*.d.ts",
        "**/*.config.{ts,mts,js,mjs}",
        "**/*.stories.tsx",
        "**/__fixtures__/**",
        "**/fixtures/**",
        "agent/**/*-fixture.ts",
        "drizzle/**",
        "evals/**",
        "src/types/**",
        "tests/**",
      ]),
    );
  });
});
