import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineEval } from "eve/evals";
import { includes, matches } from "eve/evals/expect";
import type { EveEvalToolCall } from "eve/evals";

import { planningAgentOutputSchema } from "@agent/planning-agent";

type IssueFixture = {
  body: string;
  issueNumber: number;
  labels: string[];
  repositoryFullName: string;
  title: string;
};

export const planningEvalTimeoutMs = 180_000;

export function resolveIssueFixturePath(appRoot = process.cwd()): string {
  return join(appRoot, "evals", "planning", "fixtures", "issue-13.json");
}

export async function readIssueFixture(appRoot = process.cwd()): Promise<IssueFixture> {
  const fixture = await readFile(resolveIssueFixturePath(appRoot), "utf8");
  return JSON.parse(fixture) as IssueFixture;
}

export function parsePlanningArtifactReply(reply: string | null): unknown {
  if (reply === null || reply.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(reply);
  } catch {
    return reply;
  }
}

type PlanningArtifactToolCall = Pick<EveEvalToolCall, "name" | "output">;

export function getPlanningArtifactCandidate(
  turnData: unknown,
  reply: string | null,
  toolCalls: readonly PlanningArtifactToolCall[] = [],
): unknown {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (
      toolCall?.name === "emit_plan_artifact" &&
      toolCall.output !== undefined &&
      toolCall.output !== null
    ) {
      return toolCall.output;
    }
  }

  if (turnData !== undefined && turnData !== null) {
    return turnData;
  }

  return parsePlanningArtifactReply(reply);
}

export default defineEval({
  description:
    "Issue #13 planning artifact includes gates, approvals, risks, tools, and eval coverage.",
  tags: ["planning", "issue-13"],
  timeoutMs: planningEvalTimeoutMs,
  async test(t) {
    const fixture = await readIssueFixture();

    const turn = await t.send(
      [
        `Repository: ${fixture.repositoryFullName}`,
        `Issue: #${fixture.issueNumber} ${fixture.title}`,
        `Labels: ${fixture.labels.join(", ")}`,
        "",
        fixture.body,
        "",
        "Use the planning tools when useful. Keep the artifact concise: short strings, at most five stages, five steps, four validation gates, two approval points, three risks, and two eval coverage entries.",
        "Return the planning agent artifact only.",
      ].join("\n"),
    );
    const artifact = getPlanningArtifactCandidate(turn.data, t.reply, turn.toolCalls);
    const artifactText = JSON.stringify(artifact);

    t.completed();
    t.noFailedActions();
    t.calledTool("emit_plan_artifact", {
      output: (output: unknown) => planningAgentOutputSchema.safeParse(output).success,
    });
    t.check(artifact, matches(planningAgentOutputSchema));
    t.notCalledTool("write_file");
    t.notCalledTool("web_fetch");
    t.maxToolCalls(5);
    t.check(artifactText, includes("validation"));
    t.check(artifactText, includes("approval"));
    t.check(artifactText, includes("risk"));
    t.check(artifactText, includes("eval"));
  },
});
