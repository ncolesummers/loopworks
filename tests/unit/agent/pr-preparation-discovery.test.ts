/** @vitest-environment node */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { developmentLoopStages } from "@/lib/loops/development-run";

describe("PR preparer discovery", () => {
  it("declares the Terra PR-preparation sibling and root persistence tool", async () => {
    const root = process.cwd();
    const [subagents, rootTools, rootInstructions, preparerAgent] = await Promise.all([
      readdir(join(root, "agent", "subagents")),
      readdir(join(root, "agent", "tools")),
      readFile(join(root, "agent", "instructions.md"), "utf8"),
      readFile(join(root, "agent", "subagents", "pr-preparer", "agent.ts"), "utf8"),
    ]);

    expect(subagents).toContain("pr-preparer");
    expect(rootTools).toContain("apply_pr_preparation_result.ts");
    expect(rootInstructions).toContain("PR preparation belongs to `pr-preparer`");
    expect(preparerAgent).toContain('model: "openai/gpt-5.6-terra"');
    expect(preparerAgent).toContain('reasoningEffort: "xhigh"');
    expect(developmentLoopStages.find((stage) => stage.key === "pr")).toMatchObject({
      actorId: "pr-preparer",
      actorType: "agent",
      artifacts: [{ label: "PR intent", required: true, type: "pr_intent" }],
    });
  });

  it("exposes only bounded evidence readers and the typed emitter", async () => {
    const root = join(process.cwd(), "agent", "subagents", "pr-preparer", "tools");
    const tools = await readdir(root);

    expect(tools).toEqual(
      expect.arrayContaining([
        "read_pr_preparation_context.ts",
        "read_issue_context.ts",
        "read_validation_evidence.ts",
        "read_code_review_notes.ts",
        "read_run_artifacts.ts",
        "read_deployment_context.ts",
        "read_screenshot_evidence.ts",
        "emit_pr_preparation_result.ts",
      ]),
    );
    for (const disabled of [
      "ask_question.ts",
      "bash.ts",
      "glob.ts",
      "grep.ts",
      "load_skill.ts",
      "read_file.ts",
      "todo.ts",
      "web_fetch.ts",
      "web_search.ts",
      "write_file.ts",
    ]) {
      expect(tools).toContain(disabled);
      await expect(readFile(join(root, disabled), "utf8")).resolves.toContain("disableTool");
    }
  });
});
