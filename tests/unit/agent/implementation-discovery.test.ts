/** @vitest-environment node */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { developmentLoopStages } from "@/lib/loops/development-run";

describe("implementation subagent discovery", () => {
  it("declares implementer as the development-stage sibling", async () => {
    const root = process.cwd();
    const [subagents, rootTools, rootInstructions] = await Promise.all([
      readdir(join(root, "agent", "subagents")),
      readdir(join(root, "agent", "tools")),
      readFile(join(root, "agent", "instructions.md"), "utf8"),
    ]);

    expect(subagents).toContain("implementer");
    expect(rootTools).toContain("apply_implementation_result.ts");
    expect(rootInstructions).toContain("development belongs to `implementer`");
    expect(developmentLoopStages.find((stage) => stage.key === "development")).toMatchObject({
      actorId: "implementer",
      artifacts: [{ label: "Patch artifact", required: true, type: "patch" }],
    });
  });

  it("provides a discoverable issue #48 eval and narrow implementer tools", async () => {
    const root = process.cwd();
    const [tools, evalSource, rootContextSource] = await Promise.all([
      readdir(join(root, "agent", "subagents", "implementer", "tools")),
      readFile(join(root, "evals", "implementation", "issue-48-green.eval.ts"), "utf8"),
      readFile(join(root, "agent", "tools", "read_run_stage_context.ts"), "utf8"),
    ]);
    expect(tools).toEqual(
      expect.arrayContaining([
        "read_implementation_context.ts",
        "apply_exact_test_patch.ts",
        "write_production_files.ts",
        "run_green_test_suite.ts",
        "run_aggregate_validation.ts",
        "emit_implementation_result.ts",
      ]),
    );
    expect(evalSource).toContain('calledSubagent("implementer"');
    expect(evalSource).toContain('calledTool("apply_implementation_result"');
    expect(rootContextSource).toContain("resolveImplementerFixtureMode().enabled");
    expect(rootContextSource).toContain('currentStage: "development"');
  });
});
