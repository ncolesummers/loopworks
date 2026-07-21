import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { prPreparationResultSchema } from "@agent/pr-preparation-agent";
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

type PrPreparationFixture = {
  acceptanceCriteria: string[];
  commitSha: string;
  issueNumber: number;
  repositoryFullName: string;
  title: string;
};

export const prPreparationEvalTimeoutMs = 180_000;

export function parsePrPreparationSubagentOutput(output: unknown): unknown | undefined {
  if (typeof output !== "string") return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

export function resolvePrPreparationFixturePath(appRoot = process.cwd()): string {
  return join(appRoot, "evals", "pr-preparation", "fixtures", "issue-50.json");
}

export async function readPrPreparationFixture(
  appRoot = process.cwd(),
): Promise<PrPreparationFixture> {
  return JSON.parse(await readFile(resolvePrPreparationFixturePath(appRoot), "utf8"));
}

export default defineEval({
  description:
    "The root delegates issue #50 to pr-preparer and alone persists its typed evidence-bound intent.",
  tags: ["pr-preparation", "issue-50"],
  timeoutMs: prPreparationEvalTimeoutMs,
  async test(t) {
    const fixture = await readPrPreparationFixture();
    await t.send(
      [
        "Process durable run 00000000-0000-4000-8000-000000000050.",
        "Read durable state, delegate PR preparation only to pr-preparer, and persist its result through the root control plane.",
        "Run URL: https://loopworks.example/runs?run=00000000-0000-4000-8000-000000000050",
        `Repository: ${fixture.repositoryFullName}`,
        `Commit: ${fixture.commitSha}`,
        `Issue: #${fixture.issueNumber} ${fixture.title}`,
        "Acceptance criteria:",
        ...fixture.acceptanceCriteria.map((criterion, index) => `ac-${index + 1}: ${criterion}`),
        "Use explicit PR-preparer fixture mode and emit the typed preparation result only.",
      ].join("\n"),
    );

    t.succeeded();
    t.noFailedActions();
    t.calledTool("read_run_stage_context");
    t.calledSubagent("pr-preparer", {
      output: (output: unknown) =>
        prPreparationResultSchema.safeParse(parsePrPreparationSubagentOutput(output)).success,
    });
    t.calledTool("apply_pr_preparation_result");
    t.check(JSON.stringify(t.events), includes("loopworks.pr_preparation_result.v1"));
    t.notCalledTool("write_file");
    t.notCalledTool("bash");
  },
});
