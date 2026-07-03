/** @vitest-environment node */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  cliInspectionToolContract,
  evaluateCliInspectionCommand,
  parseCliInspectionCommand,
} from "@agent/lib/cli-inspection";

const eveFrameworkToolNames = new Set([
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

describe("Planning agent CLI inspection guard", () => {
  it("allows read-only SaaS inspection commands with auditable metadata", () => {
    const decision = evaluateCliInspectionCommand(
      "gh issue view 13 --repo ncolesummers/loopworks --json number,title,body",
    );

    expect(decision).toMatchObject({
      allowed: true,
      audit: {
        commandFamily: "gh",
        mutates: false,
      },
    });
    if (!decision.allowed) {
      throw new Error("Expected command to be allowed.");
    }
    expect(decision.audit.sanitizedArgs).toEqual([
      "issue",
      "view",
      "13",
      "--repo",
      "ncolesummers/loopworks",
      "--json",
      "number,title,body",
    ]);
  });

  it("allows selected Azure read commands", () => {
    expect(evaluateCliInspectionCommand("az account show --output json")).toMatchObject({
      allowed: true,
      audit: {
        commandFamily: "az",
        mutates: false,
      },
    });
  });

  it("rejects shell constructs that can write or hide side effects", () => {
    for (const command of [
      "gh issue view 13 > /tmp/issue.json",
      "gh issue view 13 && gh issue edit 13 --add-label done",
      "gh issue view 13 | tee issue.json",
      "gh issue view 13; rm -rf .next",
    ]) {
      expect(evaluateCliInspectionCommand(command)).toMatchObject({
        allowed: false,
        reason: expect.stringContaining("shell"),
      });
    }
  });

  it("rejects repo, file, and SaaS mutations", () => {
    for (const command of [
      "git commit -am plan",
      "git branch -D stale-branch",
      "git diff --output plan.patch",
      "gh issue edit 13 --add-label status:ready",
      "gh api repos/ncolesummers/loopworks/issues/13/comments -f body=hello",
      "gh pr merge 42",
      "az deployment group create --resource-group rg --template-file main.bicep",
      "rm -rf .next",
    ]) {
      expect(evaluateCliInspectionCommand(command)).toMatchObject({
        allowed: false,
      });
    }
  });

  it("keeps the model-visible contract planning-only", () => {
    expect(cliInspectionToolContract).toMatchObject({
      name: "bash",
      mutates: false,
      requiresApprovalForMutation: true,
    });
    expect(parseCliInspectionCommand("gh issue view 13").argv).toEqual([
      "gh",
      "issue",
      "view",
      "13",
    ]);
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
