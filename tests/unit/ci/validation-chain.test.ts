import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { scannerRegistry } from "../../../scripts/run-security-scanner";

type PreCommitConfig = {
  repos: {
    repo: string;
    hooks: { id: string; entry?: string; always_run?: boolean; pass_filenames?: boolean }[];
  }[];
};

const repoRoot = path.resolve(__dirname, "../../..");
const preCommitConfig = parse(
  readFileSync(path.join(repoRoot, ".pre-commit-config.yaml"), "utf8"),
) as PreCommitConfig;

const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

const hooks = preCommitConfig.repos.flatMap((repo) => repo.hooks);

/**
 * #175 requires that the security scan is reachable from a commit, not only
 * from CI. That reachability is a three-link chain, and every link is a
 * one-line edit away from being cut without any other test noticing:
 *
 *   prek hook  ->  bun run precommit  ->  bun run validate  ->  scanners
 */
describe("local validation chain", () => {
  it("drives the precommit script from the prek hook", () => {
    const hook = hooks.find((candidate) => candidate.entry === "bun run precommit");
    expect(hook, "no prek hook invokes `bun run precommit`").toBeDefined();
    // Without both of these the hook only fires for some staged file sets, so
    // a commit touching nothing it matches would skip every gate.
    expect(hook?.always_run, "the validation hook does not always run").toBe(true);
    expect(hook?.pass_filenames, "the validation hook passes filenames").toBe(false);
  });

  it("runs commit provenance preflight before delegating to validate", () => {
    // Provenance is commit-context policy, while validate is the repository
    // quality chain. Keep both repository-owned and keep provenance first so a
    // fixture identity fails before the expensive aggregate gate.
    expect(packageJson.scripts["commit:preflight"]).toBe(
      "bun run scripts/check-commit-provenance.ts --local",
    );
    expect(packageJson.scripts.precommit).toBe("bun run commit:preflight && bun run validate");
  });

  it("reaches every validate-lane scanner from validate", () => {
    const gates = packageJson.scripts.validate.split("&&").map((command) => command.trim());
    for (const scanner of scannerRegistry.filter((entry) => entry.lane === "validate")) {
      expect(gates, `\`bun run validate\` no longer reaches \`${scanner.script}\``).toContain(
        `bun run ${scanner.script}`,
      );
    }
  });
});
