/** @vitest-environment node */
import { readFileSync } from "node:fs";

const rootGuide = readFileSync("AGENTS.md", "utf8");
const appGuide = readFileSync("src/AGENTS.md", "utf8");

describe("agent context budget", () => {
  it("keeps universal guidance small and routes UI detail to its scope", () => {
    expect(rootGuide).not.toContain("## Design Context");
    expect(appGuide).toContain("ADR 0009");
    expect(appGuide).toContain("docs/design-review-checklist.md");
    expect(appGuide).toContain("src/components/AGENTS.md");
  });
});
