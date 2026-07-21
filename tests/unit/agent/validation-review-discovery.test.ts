/** @vitest-environment node */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { developmentLoopStages } from "@/lib/loops/development-run";

describe("validation reviewer discovery", () => {
  it("declares the Terra reviewer as the code-review sibling", async () => {
    const root = process.cwd();
    const [subagents, rootTools, rootInstructions, reviewerAgent] = await Promise.all([
      readdir(join(root, "agent", "subagents")),
      readdir(join(root, "agent", "tools")),
      readFile(join(root, "agent", "instructions.md"), "utf8"),
      readFile(join(root, "agent", "subagents", "validation-reviewer", "agent.ts"), "utf8"),
    ]);

    expect(subagents).toContain("validation-reviewer");
    expect(rootTools).toContain("apply_validation_review_result.ts");
    expect(rootInstructions).toContain("code review belongs to `validation-reviewer`");
    expect(reviewerAgent).toContain('model: "openai/gpt-5.6-terra"');
    expect(reviewerAgent).toContain('reasoningEffort: "xhigh"');
    expect(developmentLoopStages.find((stage) => stage.key === "code-review")).toMatchObject({
      actorId: "validation-reviewer",
      actorType: "agent",
      artifacts: [{ label: "Code review notes", required: true, type: "log_summary" }],
    });
  });

  it("exposes only narrow evidence-reading and emission tools", async () => {
    const tools = await readdir(
      join(process.cwd(), "agent", "subagents", "validation-reviewer", "tools"),
    );

    expect([...tools].sort()).toEqual(
      [
        "ask_question.ts",
        "bash.ts",
        "emit_validation_review_result.ts",
        "glob.ts",
        "grep.ts",
        "list_repository_files.ts",
        "load_skill.ts",
        "read_file.ts",
        "read_repository_files.ts",
        "read_review_patch.ts",
        "read_screenshot_evidence.ts",
        "read_test_plan_steps.ts",
        "read_validation_results.ts",
        "read_validation_review_context.ts",
        "search_repository.ts",
        "todo.ts",
        "web_fetch.ts",
        "web_search.ts",
        "write_file.ts",
      ].sort(),
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
      await expect(
        readFile(
          join(process.cwd(), "agent", "subagents", "validation-reviewer", "tools", disabled),
          "utf8",
        ),
      ).resolves.toContain("disableTool");
    }
    expect(tools).not.toContain("write_production_files.ts");
  });
});
