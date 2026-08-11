import { readdirSync } from "node:fs";
import { join } from "node:path";
import defaultConfig from "../../../playwright.config";
import seededConfig from "../../../playwright.seeded.config";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const e2eDir = join(repoRoot, "tests", "e2e");

/**
 * Every Playwright project selects its specs with `testMatch`, so a new spec file that no project
 * names does not run - and `bun run validate` stays green while covering nothing. #214 added
 * `tests/e2e/sign-in.spec.ts` and the `sign-in` project together; this keeps the next pair
 * honest.
 */
function projectMatchers(): RegExp[] {
  return [...(defaultConfig.projects ?? []), ...(seededConfig.projects ?? [])]
    .map((project) => project.testMatch)
    .filter((matcher): matcher is RegExp => matcher instanceof RegExp);
}

describe("Playwright spec coverage", () => {
  it("runs every end-to-end spec under some project", () => {
    const matchers = projectMatchers();
    const specs = readdirSync(e2eDir).filter((name) => name.endsWith(".spec.ts"));

    expect(specs.length).toBeGreaterThan(0);

    const unmatched = specs.filter((spec) => !matchers.some((matcher) => matcher.test(spec)));

    expect(
      unmatched,
      "these e2e specs are matched by no Playwright project, so they never run; add a project testMatch for them",
    ).toEqual([]);
  });

  it("keeps the sign-in surface in the default lane rather than a seeded one", () => {
    const names = (defaultConfig.projects ?? []).map((project) => project.name);

    expect(names).toContain("sign-in");
  });
});
