/** @vitest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

describe("neutral root research routing contract", () => {
  it("returns loop identity and fails closed for the undeclared research actors", () => {
    const instructions = readFileSync("agent/instructions.md", "utf8");
    const contextTool = readFileSync("agent/tools/read_run_stage_context.ts", "utf8");
    const declaredSubagents = readdirSync("agent/subagents", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(contextTool).toContain("loopKey");
    expect(instructions).toContain("research-loop");
    expect(instructions).toContain("planning → researching → authoring → done");
    expect(instructions).toMatch(/fail closed/i);
    expect(instructions).toContain("#44");
    expect(instructions).toContain("#45");
    expect(instructions).toContain("#46");
    expect(declaredSubagents).not.toContain("research-planner");
    expect(declaredSubagents).not.toContain("researcher");
    expect(declaredSubagents).not.toContain("research-author");
  });

  it("keeps every development fixture context explicitly scoped to development-loop", () => {
    const contextTool = readFileSync(
      path.join(process.cwd(), "agent/tools/read_run_stage_context.ts"),
      "utf8",
    );

    expect(contextTool.match(/loopKey: "development-loop"/g)).toHaveLength(4);
  });
});
