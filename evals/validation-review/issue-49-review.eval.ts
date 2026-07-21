import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { validationReviewResultSchema } from "@agent/validation-review-agent";
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

type ValidationReviewFixture = {
  acceptanceCriteria: string[];
  commitSha: string;
  issueNumber: number;
  repositoryFullName: string;
  title: string;
};

export const validationReviewEvalTimeoutMs = 180_000;

export function parseValidationReviewSubagentOutput(output: unknown): unknown | undefined {
  if (typeof output !== "string") return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

export function resolveValidationReviewFixturePath(appRoot = process.cwd()): string {
  return join(appRoot, "evals", "validation-review", "fixtures", "issue-49.json");
}

export async function readValidationReviewFixture(
  appRoot = process.cwd(),
): Promise<ValidationReviewFixture> {
  return JSON.parse(await readFile(resolveValidationReviewFixturePath(appRoot), "utf8"));
}

export default defineEval({
  description:
    "The root delegates issue #49 to validation-reviewer and alone applies its typed evidence-bound route.",
  tags: ["validation-review", "issue-49"],
  timeoutMs: validationReviewEvalTimeoutMs,
  async test(t) {
    const fixture = await readValidationReviewFixture();
    await t.send(
      [
        "Process durable run 00000000-0000-4000-8000-000000000049.",
        "Read durable state, delegate code review only to validation-reviewer, and apply its route through the root control plane.",
        `Repository: ${fixture.repositoryFullName}`,
        `Commit: ${fixture.commitSha}`,
        `Issue: #${fixture.issueNumber} ${fixture.title}`,
        "Acceptance criteria:",
        ...fixture.acceptanceCriteria.map((criterion, index) => `ac-${index + 1}: ${criterion}`),
        "Use explicit validation-reviewer fixture mode and emit the typed review result only.",
      ].join("\n"),
    );

    t.succeeded();
    t.noFailedActions();
    t.calledTool("read_run_stage_context");
    t.calledSubagent("validation-reviewer", {
      output: (output: unknown) =>
        validationReviewResultSchema.safeParse(parseValidationReviewSubagentOutput(output)).success,
    });
    t.calledTool("apply_validation_review_result");
    t.check(JSON.stringify(t.events), includes("loopworks.validation_review_result.v1"));
    t.notCalledTool("write_file");
    t.notCalledTool("bash");
  },
});
