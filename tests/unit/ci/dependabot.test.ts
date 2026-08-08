import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type DependabotUpdate = {
  directory?: string;
  groups?: Record<
    string,
    {
      "dependency-type"?: string;
      "exclude-patterns"?: string[];
      patterns?: string[];
      "update-types"?: string[];
    }
  >;
  "open-pull-requests-limit"?: number;
  "package-ecosystem"?: string;
  schedule?: { day?: string; interval?: string; time?: string; timezone?: string };
};

type DependabotConfig = {
  updates?: DependabotUpdate[];
  version?: number;
};

const repoRoot = path.resolve(__dirname, "../../..");
const configPath = path.join(repoRoot, ".github/dependabot.yml");
const source = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
const config = (parse(source) ?? {}) as DependabotConfig;

describe("Dependabot version updates", () => {
  it("keeps a repository-owned Dependabot configuration", () => {
    expect(existsSync(configPath)).toBe(true);
    expect(config.version).toBe(2);
  });

  it("updates the Bun lockfile weekly without hiding runtime migrations in a group", () => {
    const bun = config.updates?.find((update) => update["package-ecosystem"] === "bun");
    expect(bun).toMatchObject({
      directory: "/",
      "open-pull-requests-limit": 10,
      schedule: {
        day: "monday",
        interval: "weekly",
        time: "09:00",
        timezone: "America/Los_Angeles",
      },
    });
    expect(bun?.groups?.["production-non-major"]).toMatchObject({
      "dependency-type": "production",
      "update-types": ["minor", "patch"],
    });
    expect(bun?.groups?.["production-non-major"]?.["exclude-patterns"]).toEqual(
      expect.arrayContaining(["eve", "next", "next-auth", "@auth/*", "@opentelemetry/*"]),
    );
    expect(bun?.groups?.["development-non-major"]).toMatchObject({
      "dependency-type": "development",
      "update-types": ["minor", "patch"],
    });
  });

  it("updates GitHub Actions weekly", () => {
    const actions = config.updates?.find(
      (update) => update["package-ecosystem"] === "github-actions",
    );
    expect(actions).toMatchObject({
      directory: "/",
      schedule: { day: "monday", interval: "weekly" },
    });
  });
});
