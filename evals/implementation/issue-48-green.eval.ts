import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { implementationResultSchema } from "@agent/implementation-agent";
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

type ImplementationFixture = {
  acceptanceCriteria: string[];
  commitSha: string;
  issueNumber: number;
  repositoryFullName: string;
  title: string;
};

export const implementationEvalTimeoutMs = 180_000;

export function parseImplementationSubagentOutput(output: unknown): unknown | undefined {
  if (typeof output !== "string") return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

export function resolveImplementationFixturePath(appRoot = process.cwd()): string {
  return join(appRoot, "evals", "implementation", "fixtures", "issue-48.json");
}

export async function readImplementationFixture(
  appRoot = process.cwd(),
): Promise<ImplementationFixture> {
  return JSON.parse(await readFile(resolveImplementationFixturePath(appRoot), "utf8"));
}

export default defineEval({
  description:
    "The root delegates issue #48 to implementer and persists a digest-bound green implementation result.",
  tags: ["implementation", "issue-48"],
  timeoutMs: implementationEvalTimeoutMs,
  async test(t) {
    const fixture = await readImplementationFixture();
    await t.send(
      [
        "Process durable run 00000000-0000-4000-8000-000000000048.",
        "Read durable state, delegate development only to implementer, and persist through the control plane.",
        `Repository: ${fixture.repositoryFullName}`,
        `Commit: ${fixture.commitSha}`,
        `Issue: #${fixture.issueNumber} ${fixture.title}`,
        "Acceptance criteria:",
        ...fixture.acceptanceCriteria.map((criterion, index) => `ac-${index + 1}: ${criterion}`),
        "Use explicit implementer fixture mode and emit the typed implementation result only.",
      ].join("\n"),
    );

    t.succeeded();
    t.noFailedActions();
    t.calledTool("read_run_stage_context");
    t.calledSubagent("implementer", {
      output: (output: unknown) =>
        implementationResultSchema.safeParse(parseImplementationSubagentOutput(output)).success,
    });
    t.calledTool("apply_implementation_result");
    t.check(JSON.stringify(t.events), includes("loopworks.implementation_result.v1"));
    t.notCalledTool("write_file");
    t.notCalledTool("bash");
  },
});
