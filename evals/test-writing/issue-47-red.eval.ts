import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { testWritingAgentOutputSchema } from "@agent/test-writing-agent";
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

type TestWritingFixture = {
  acceptanceCriteria: string[];
  commitSha: string;
  issueNumber: number;
  repositoryFullName: string;
  title: string;
};

export const testWritingEvalTimeoutMs = 180_000;

export function resolveTestWritingFixturePath(appRoot = process.cwd()): string {
  return join(appRoot, "evals", "test-writing", "fixtures", "issue-47.json");
}

export async function readTestWritingFixture(appRoot = process.cwd()): Promise<TestWritingFixture> {
  return JSON.parse(await readFile(resolveTestWritingFixturePath(appRoot), "utf8"));
}

export default defineEval({
  description:
    "The root orchestrator delegates issue #47 to test-writer and receives loopworks.test_plan.v1 plus expected-red evidence.",
  tags: ["test-writing", "issue-47"],
  timeoutMs: testWritingEvalTimeoutMs,
  async test(t) {
    const fixture = await readTestWritingFixture();
    await t.send(
      [
        "Process durable run 00000000-0000-4000-8000-000000000047.",
        "Read its durable state, delegate only when the exact plan-review is approved, and persist the result through the control plane.",
        `Repository: ${fixture.repositoryFullName}`,
        `Commit: ${fixture.commitSha}`,
        `Issue: #${fixture.issueNumber} ${fixture.title}`,
        "Acceptance criteria:",
        ...fixture.acceptanceCriteria.map((criterion, index) => `ac-${index + 1}: ${criterion}`),
        "Use explicit fixture mode. Emit the typed test-writing output only.",
      ].join("\n"),
    );

    t.completed();
    t.noFailedActions();
    t.calledTool("read_run_stage_context");
    t.calledSubagent("test-writer", {
      output: (output: unknown) => testWritingAgentOutputSchema.safeParse(output).success,
    });
    t.calledTool("apply_test_writing_result");
    t.check(JSON.stringify(t.events), includes("loopworks.test_plan.v1"));
    t.notCalledTool("write_file");
    t.notCalledTool("bash");
  },
});
