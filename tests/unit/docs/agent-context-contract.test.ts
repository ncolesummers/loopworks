/** @vitest-environment node */
import { readFileSync, readlinkSync, statSync } from "node:fs";

const rootGuide = readFileSync("AGENTS.md", "utf8");
const appGuide = readFileSync("src/AGENTS.md", "utf8");
const implementIssueSkill = readFileSync(".agents/skills/implement-issue/SKILL.md", "utf8");
const implementIssuePrSkill = readFileSync(".agents/skills/implement-issue-pr/SKILL.md", "utf8");
const tddImplementSkill = readFileSync(".agents/skills/tdd-implement/SKILL.md", "utf8");
const browserValidateSkill = readFileSync(".agents/skills/browser-validate/SKILL.md", "utf8");
const commitSignedPrSkill = readFileSync(".agents/skills/commit-signed-pr/SKILL.md", "utf8");
const adrIndex = readFileSync("docs/adr/README.md", "utf8");

describe("agent context budget", () => {
  it("keeps universal guidance small and routes UI detail to its scope", () => {
    expect(rootGuide).not.toContain("## Design Context");
    expect(appGuide).toContain("ADR 0009");
    expect(appGuide).toContain("docs/design-review-checklist.md");
    expect(appGuide).toContain("src/components/AGENTS.md");
  });

  it("requires contributor-safe signed commit provenance when publication is authorized", () => {
    expect(rootGuide).toContain("## Commit provenance");
    expect(rootGuide).toContain("GitHub-resolved");
    expect(rootGuide).toContain("reserved fixture");
    expect(rootGuide).toContain("git commit -S");
    expect(rootGuide).toContain("Retain the complete `bun run commit:preflight` output");
    expect(rootGuide).toContain("gh auth token");
    expect(rootGuide).toContain("GITHUB_REPOSITORY");
    expect(rootGuide).toContain("Push is required before GitHub metadata exists");
    expect(rootGuide).not.toContain("Every commit must use Nathan Summers <nsummers72@gmail.com>");

    expect(implementIssuePrSkill).toContain("commit-signed-pr");
    expect(commitSignedPrSkill).toContain("bun run commit:preflight");
    expect(commitSignedPrSkill).toContain("git commit -S");
    expect(commitSignedPrSkill).toContain("commit:provenance --github");
    expect(commitSignedPrSkill).toContain(
      "Stop on any GitHub-resolved author or signature mismatch",
    );
  });

  it("keeps shared craft in phase skills and both entrypoints as composers", () => {
    for (const composer of [implementIssueSkill, implementIssuePrSkill]) {
      expect(composer).toContain("tdd-implement");
      expect(composer).toContain("browser-validate");
      expect(composer).toContain("## Managed mode");
      expect(composer).not.toContain("## Subagents");
    }
    expect(tddImplementSkill).toContain("red-to-green");
    expect(browserValidateSkill).toContain("accessibility");
    expect(implementIssueSkill).not.toContain("git commit -S");
    expect(implementIssueSkill).not.toContain("gh pr create");
  });

  it("ships the worktree variant through the shared .agents skill directory", () => {
    expect(readlinkSync(".claude/skills/implement-issue-pr")).toBe(
      "../../.agents/skills/implement-issue-pr",
    );
    // Resolves, so the symlink is not left dangling by a partial commit.
    expect(statSync(".claude/skills/implement-issue-pr/SKILL.md").isFile()).toBe(true);
    expect(implementIssuePrSkill).toContain("name: implement-issue-pr\n");
    for (const skill of ["tdd-implement", "browser-validate", "commit-signed-pr"]) {
      expect(readlinkSync(`.claude/skills/${skill}`)).toBe(`../../.agents/skills/${skill}`);
      expect(statSync(`.claude/skills/${skill}/SKILL.md`).isFile()).toBe(true);
    }
  });

  it("ships the gh-stack skill through the shared .agents skill directory", () => {
    expect(readlinkSync(".claude/skills/gh-stack")).toBe("../../.agents/skills/gh-stack");
    // Resolves, so the symlink is not left dangling by a partial commit.
    expect(statSync(".claude/skills/gh-stack/SKILL.md").isFile()).toBe(true);
  });

  it("gives the worktree variant its own branch, commits, and draft PR", () => {
    expect(implementIssuePrSkill).toContain("sibling issue worktree");
    expect(implementIssuePrSkill).toContain("commit-signed-pr");
    expect(commitSignedPrSkill).toContain("Conventional Commit");
    expect(commitSignedPrSkill).toContain("git commit -S");
    expect(commitSignedPrSkill).toContain("draft pull request");
    expect(commitSignedPrSkill).toContain("Closes #<issue>");
    expect(commitSignedPrSkill).not.toContain("--fill");
    expect(commitSignedPrSkill).toContain("commit:provenance --github");
  });

  it("indexes the proposed signed provenance decision and its migration boundary", () => {
    const adr = readFileSync("docs/adr/0026-github-bound-signed-commit-provenance.md", "utf8");

    expect(adrIndex).toContain("0026-github-bound-signed-commit-provenance.md");
    expect(adr).toContain("Status: Proposed");
    expect(adr).toContain("https://github.com/ncolesummers/loopworks/issues/209");
    expect(adr).toContain("GitHub-resolved");
    expect(adr).toContain("required signatures");
    expect(adr).toContain("Dependabot");
    expect(adr).toContain("Do not rewrite published history");
  });
});
