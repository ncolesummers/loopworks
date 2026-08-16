/** @vitest-environment node */
import { readFileSync, readlinkSync, statSync } from "node:fs";

/**
 * Splits a SKILL.md into `{ heading: body }`, keyed by heading text with any
 * `N. ` step numbering stripped, so two skills can be compared section by
 * section even when the same section sits at different step numbers.
 */
function skillSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | undefined;
  let body: string[] = [];

  const flush = () => {
    if (heading) sections.set(heading, body.join("\n").trim());
  };

  for (const line of markdown.split("\n")) {
    const match = /^#{2,3}\s+(?:\d+\.\s+)?(.*)$/.exec(line);
    if (!match) {
      body.push(line);
      continue;
    }
    flush();
    heading = match[1].trim();
    body = [];
  }
  flush();

  return sections;
}

const rootGuide = readFileSync("AGENTS.md", "utf8");
const appGuide = readFileSync("src/AGENTS.md", "utf8");
const implementIssueSkill = readFileSync(".agents/skills/implement-issue/SKILL.md", "utf8");
const implementIssuePrSkill = readFileSync(".agents/skills/implement-issue-pr/SKILL.md", "utf8");
const adrIndex = readFileSync("docs/adr/README.md", "utf8");

/** Sections both skills must keep byte-identical. */
const sharedSkillSections = [
  "Resolve",
  "Test plan, before any implementation code",
  "TDD",
  "Browser validation",
  "Subagents",
  "Adversarial review",
  "Acceptance evidence",
];

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

  it("keeps the authorized worktree variant in parity with the paused workflow", () => {
    const paused = skillSections(implementIssueSkill);
    const authorized = skillSections(implementIssuePrSkill);

    for (const section of sharedSkillSections) {
      expect(paused.get(section), `implement-issue is missing "${section}"`).toBeDefined();
      expect(
        authorized.get(section),
        `implement-issue-pr diverged from implement-issue in "${section}"`,
      ).toBe(paused.get(section));
    }
  });

  it("ships the worktree variant through the shared .agents skill directory", () => {
    expect(readlinkSync(".claude/skills/implement-issue-pr")).toBe(
      "../../.agents/skills/implement-issue-pr",
    );
    // Resolves, so the symlink is not left dangling by a partial commit.
    expect(statSync(".claude/skills/implement-issue-pr/SKILL.md").isFile()).toBe(true);
    expect(implementIssuePrSkill).toContain("name: implement-issue-pr\n");
  });

  it("ships the gh-stack skill through the shared .agents skill directory", () => {
    expect(readlinkSync(".claude/skills/gh-stack")).toBe("../../.agents/skills/gh-stack");
    // Resolves, so the symlink is not left dangling by a partial commit.
    expect(statSync(".claude/skills/gh-stack/SKILL.md").isFile()).toBe(true);
  });

  it("gives the worktree variant its own branch, commits, and draft PR", () => {
    const authorized = skillSections(implementIssuePrSkill);

    const isolate = authorized.get("Isolate") ?? "";
    expect(isolate).toContain('git worktree add -b "<feature>/<issue_#>-<issue_description>"');
    // A worktree under .claude/ is gitignored, so security:osv finds no package
    // sources there and every commit fails the validate chain.
    expect(isolate).toContain('"../loopworks-worktrees/<issue_#>-<issue_description>"');
    const publish = authorized.get("Commit and open the draft PR") ?? "";
    expect(publish).toContain("Conventional Commits");
    expect(publish).toContain("git commit -S");
    expect(publish).toContain("gh pr create --draft --base main");
    expect(publish).toContain("Closes #<issue_#>");
    // `--fill` would replace the PR template, dropping the closing keyword.
    const publishCommands = publish.match(/```bash\n([\s\S]*?)```/g)?.join("\n") ?? "";
    expect(publishCommands).toContain("--body-file");
    expect(publishCommands).not.toContain("--fill");
    expect(publish).toContain("commit:provenance --github");
    expect(authorized.get("Validate")).toContain("commit:preflight");

    // The paused workflow must not grow autonomous publication.
    expect(implementIssueSkill).toContain(
      "Never create, switch, rebase, or clean branches or worktrees",
    );
    expect(implementIssueSkill).not.toContain("gh pr create");
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
