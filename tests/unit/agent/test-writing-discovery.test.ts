/** @vitest-environment node */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { artifactTypeEnum } from "@/db/schema";
import { developmentLoopStages } from "@/lib/loops/development-run";
import * as developmentLoopTransitions from "@/lib/loops/development-run-transitions";

describe("Eve stage orchestrator discovery", () => {
  it("uses a neutral root orchestrator with planner and test-writer siblings", async () => {
    const root = process.cwd();
    const [rootInstructions, rootAgent, plannerAgent, testWriterAgent] = await Promise.all([
      readFile(join(root, "agent", "instructions.md"), "utf8"),
      readFile(join(root, "agent", "agent.ts"), "utf8"),
      readFile(join(root, "agent", "subagents", "planner", "agent.ts"), "utf8"),
      readFile(join(root, "agent", "subagents", "test-writer", "agent.ts"), "utf8"),
    ]);

    expect(rootInstructions).toContain("stage orchestrator");
    expect(rootAgent).toContain('model: "openai/gpt-5.6-sol"');
    expect(plannerAgent).toContain('description: "Create an approved executable plan artifact');
    expect(plannerAgent).toContain('model: "openai/gpt-5.6-sol"');
    expect(testWriterAgent).toContain('description: "Write focused failing tests');
    expect(testWriterAgent).toContain('model: "openai/gpt-5.6-terra"');
  });

  it("requires a dedicated test-plan artifact beside red evidence", () => {
    expect(artifactTypeEnum.enumValues).toContain("test_plan");

    const testWriting = developmentLoopStages.find((stage) => stage.key === "test-writing");
    expect(testWriting).toMatchObject({ actorId: "test-writer" });
    expect(testWriting?.artifacts).toEqual([
      { label: "Red test evidence", required: true, type: "validation_report" },
      { label: "Automated test plan", required: true, type: "test_plan" },
    ]);
  });

  it("exposes a deterministic test-writing transition owned by the control plane", () => {
    expect("applyDevelopmentLoopTestWritingResult" in developmentLoopTransitions).toBe(true);
  });

  it("gives each stage agent a narrow, explicit tool surface", async () => {
    const root = process.cwd();
    const [rootTools, plannerTools, testWriterTools] = await Promise.all([
      readdir(join(root, "agent", "tools")),
      readdir(join(root, "agent", "subagents", "planner", "tools")),
      readdir(join(root, "agent", "subagents", "test-writer", "tools")),
    ]);

    expect(rootTools).toEqual(
      expect.arrayContaining([
        "apply_test_writing_result.ts",
        "bash.ts",
        "read_run_stage_context.ts",
        "record_plan_artifact.ts",
      ]),
    );
    expect(plannerTools).toEqual(
      expect.arrayContaining([
        "bash.ts",
        "emit_plan_artifact.ts",
        "list_repository_files.ts",
        "prepare_repository_context.ts",
        "read_repository_files.ts",
        "read_issue_context.ts",
        "search_repository.ts",
        "summarize_validation_requirements.ts",
      ]),
    );
    expect(testWriterTools).toEqual(
      expect.arrayContaining([
        "emit_test_writing_artifacts.ts",
        "list_repository_files.ts",
        "read_repository_files.ts",
        "read_approved_plan.ts",
        "run_test_suite.ts",
        "write_test_files.ts",
      ]),
    );

    expect(rootTools).not.toContain("emit_plan_artifact.ts");
  });

  it("provides a discoverable issue #47 Eve eval path", async () => {
    const evalSource = await readFile(
      join(process.cwd(), "evals", "test-writing", "issue-47-red.eval.ts"),
      "utf8",
    );
    expect(evalSource).toContain("test-writer");
    expect(evalSource).toContain("loopworks.test_plan.v1");
    expect(evalSource).toContain('calledTool("read_run_stage_context"');
    expect(evalSource).toContain('calledSubagent("test-writer"');
    expect(evalSource).toContain('calledTool("apply_test_writing_result"');
  });

  it("labels root telemetry as orchestration without raw agent IO", async () => {
    const source = await readFile(join(process.cwd(), "agent", "instrumentation.ts"), "utf8");
    expect(source).toContain('"loopworks.agent": "stage-orchestrator"');
    expect(source).not.toContain('"loopworks.agent": "planning-agent"');
    expect(source).toContain("recordInputs: telemetryPolicy.recordInputs");
    expect(source).toContain("recordOutputs: telemetryPolicy.recordOutputs");
  });
});
