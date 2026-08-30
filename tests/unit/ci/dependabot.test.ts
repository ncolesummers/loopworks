import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type DependabotUpdate = {
  "commit-message"?: { prefix?: string };
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
  "multi-ecosystem-group"?: string;
  "package-ecosystem"?: string;
  patterns?: string[];
  schedule?: { day?: string; interval?: string; time?: string; timezone?: string };
};

type DependabotConfig = {
  "multi-ecosystem-groups"?: Record<
    string,
    {
      "commit-message"?: { prefix?: string };
      schedule?: { day?: string; interval?: string; time?: string; timezone?: string };
    }
  >;
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

  it("uses one monthly cross-ecosystem version-update group", () => {
    expect(config["multi-ecosystem-groups"]).toEqual({
      "monthly-version-updates": {
        "commit-message": { prefix: "chore(deps)" },
        schedule: {
          interval: "monthly",
          time: "09:00",
          timezone: "America/Los_Angeles",
        },
      },
    });

    const groupSchedule = config["multi-ecosystem-groups"]?.["monthly-version-updates"]?.schedule;
    expect(groupSchedule?.day).toBeUndefined();
  });

  it("assigns every Bun and GitHub Actions version update to the monthly group", () => {
    expect(config.updates).toHaveLength(2);

    const bun = config.updates?.find((update) => update["package-ecosystem"] === "bun");
    expect(bun).toMatchObject({
      directory: "/",
      "multi-ecosystem-group": "monthly-version-updates",
      patterns: ["*"],
    });
    const actions = config.updates?.find(
      (update) => update["package-ecosystem"] === "github-actions",
    );
    expect(actions).toMatchObject({
      directory: "/",
      "multi-ecosystem-group": "monthly-version-updates",
      patterns: ["*"],
    });

    for (const update of config.updates ?? []) {
      expect(update.schedule).toBeUndefined();
      expect(update.groups).toBeUndefined();
      expect(update.patterns).toEqual(["*"]);
      expect(update["multi-ecosystem-group"]).toBe("monthly-version-updates");
      expect(update["commit-message"]).toBeUndefined();
    }
  });
});
