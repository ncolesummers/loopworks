import { readFileSync } from "node:fs";

describe("preview alias hosted-validation workflow", () => {
  it("queues alias-bound hosted validation and verifies the alias after assignment", () => {
    const workflow = readFileSync(".github/workflows/preview-alias.yml", "utf8");

    expect(workflow).toMatch(/group:\s*preview-alias/);
    expect(workflow).toMatch(/cancel-in-progress:\s*false/);
    expect(workflow).toContain("bun run scripts/assert-preview-alias-lease.ts");
    expect(workflow).toContain("bun run scripts/verify-preview-alias.ts");
    expect(workflow.match(/bun run scripts\/assert-preview-alias-lease\.ts/g)).toHaveLength(1);
    expect(workflow).toContain('--pull-request "$PULL_REQUEST_NUMBER"');
    expect(workflow).not.toContain("--not-before");
  });
});
