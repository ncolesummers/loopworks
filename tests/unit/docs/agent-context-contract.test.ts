/** @vitest-environment node */
import { readFileSync } from "node:fs";

const rootGuide = readFileSync("AGENTS.md", "utf8");
const appGuide = readFileSync("src/AGENTS.md", "utf8");
const implementIssueSkill = readFileSync(".agents/skills/implement-issue/SKILL.md", "utf8");
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

    expect(implementIssueSkill).toContain("### 6. Publish when explicitly authorized");
    expect(implementIssueSkill).toContain("bun run commit:preflight");
    expect(implementIssueSkill).toContain("git commit -S");
    expect(implementIssueSkill).toContain("commit:provenance --github");
    expect(implementIssueSkill).toContain("No user");
    expect(implementIssueSkill).toContain("handoff occurs before this verification passes");
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
