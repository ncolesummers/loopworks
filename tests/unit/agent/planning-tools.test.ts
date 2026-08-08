/** @vitest-environment node */
import { access, readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const eveFrameworkToolNames = new Set([
  "agent",
  "ask_question",
  "bash",
  "glob",
  "grep",
  "load_skill",
  "read_file",
  "todo",
  "web_fetch",
  "web_search",
  "write_file",
]);

describe("Planning agent tool boundary", () => {
  it("does not expose a planner bash override and keeps root bash disabled", async () => {
    const plannerToolsDirectory = join(process.cwd(), "agent", "subagents", "planner", "tools");
    const plannerTools = await readdir(plannerToolsDirectory);
    const rootBashSource = await readFile(join(process.cwd(), "agent", "tools", "bash.ts"), "utf8");

    expect(plannerTools).not.toContain("bash.ts");
    expect(plannerTools).toEqual(
      expect.arrayContaining([
        "list_github_backlog.ts",
        "list_github_backlog_taxonomy.ts",
        "read_github_backlog_item.ts",
      ]),
    );
    expect(rootBashSource).toContain("disableTool");
    expect(rootBashSource).not.toContain("defineTool");
  });

  it("binds GitHub backlog tools to the initiating host principal", async () => {
    const toolsDirectory = join(process.cwd(), "agent", "subagents", "planner", "tools");

    for (const file of [
      "list_github_backlog.ts",
      "read_github_backlog_item.ts",
      "list_github_backlog_taxonomy.ts",
    ]) {
      const source = await readFile(join(toolsDirectory, file), "utf8");
      expect(source).toContain("ctx.session.auth");
      expect(source).toContain("readActiveLoopRunId");
      expect(source).not.toMatch(/input\.runId|runId:\s*z\./);
    }
  });

  it("has no planner-owned CLI inspection implementation", async () => {
    const plannerSources = [
      join(process.cwd(), "agent", "planning-agent.ts"),
      join(process.cwd(), "agent", "subagents", "planner", "agent.ts"),
      join(process.cwd(), "agent", "subagents", "planner", "instructions.md"),
    ];
    const plannerToolFiles = await readdir(
      join(process.cwd(), "agent", "subagents", "planner", "tools"),
    );

    plannerSources.push(
      ...plannerToolFiles
        .filter((file) => file.endsWith(".ts"))
        .map((file) => join(process.cwd(), "agent", "subagents", "planner", "tools", file)),
    );

    for (const sourcePath of plannerSources) {
      const source = await readFile(sourcePath, "utf8");
      expect(source).not.toMatch(/execFile|cli-inspection/);
    }

    await expect(
      access(join(process.cwd(), "agent", "lib", "cli-inspection.ts")),
    ).rejects.toThrow();
  });

  it("only disables Eve framework tools that exist at runtime", async () => {
    const toolsDirectory = join(process.cwd(), "agent", "tools");
    const files = await readdir(toolsDirectory);
    const disabledToolNames: string[] = [];

    for (const file of files) {
      if (!file.endsWith(".ts")) {
        continue;
      }

      const source = await readFile(join(toolsDirectory, file), "utf8");
      if (source.includes("disableTool")) {
        disabledToolNames.push(basename(file, ".ts"));
      }
    }

    expect(disabledToolNames).toEqual(
      expect.arrayContaining(["ask_question", "glob", "grep", "read_file", "write_file"]),
    );
    expect(disabledToolNames.filter((toolName) => !eveFrameworkToolNames.has(toolName))).toEqual(
      [],
    );
  });
});
