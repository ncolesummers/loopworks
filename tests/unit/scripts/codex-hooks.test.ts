import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildPreToolUseReport,
  buildPromptSubmitReport,
  buildStopReport,
  buildSubagentStartReport,
  extractTouchedPaths,
  isGeneratedPath,
  listChangedFilesFromGit,
  parseHookInput,
  type ChangedFile,
} from "../../../.codex/hooks/lib";

describe("codex hook guardrails", () => {
  it("parses hook stdin defensively", () => {
    expect(parseHookInput('{"prompt":"Implement issue #1"}')).toEqual({
      prompt: "Implement issue #1",
    });
    expect(parseHookInput("not json")).toEqual({ raw: "not json" });
    expect(parseHookInput("")).toEqual({});
  });

  it("extracts touched file paths from nested tool payloads", () => {
    const payload = {
      tool_input: {
        changes: [{ path: "CLAUDE.md" }, { file_path: "src/components/portal/artifact-item.tsx" }],
      },
    };

    expect(extractTouchedPaths(payload)).toEqual([
      "CLAUDE.md",
      "src/components/portal/artifact-item.tsx",
    ]);
  });

  it("extracts touched paths from apply_patch text markers", () => {
    const payload = {
      tool_input: {
        patch:
          "*** Begin Patch\n*** Update File: .codex/CLAUDE.md\n@@\n-old\n+new\n*** End Patch\n",
      },
    };

    expect(extractTouchedPaths(payload)).toEqual([".codex/CLAUDE.md"]);
  });

  it("identifies generated paths that Codex should not edit by hand", () => {
    expect(isGeneratedPath("CLAUDE.md")).toBe(true);
    expect(isGeneratedPath(".codex/CLAUDE.md")).toBe(true);
    expect(isGeneratedPath("storybook-static/index.html")).toBe(true);
    expect(isGeneratedPath("coverage/lcov.info")).toBe(true);
    expect(isGeneratedPath("src/components/portal/status-badge.tsx")).toBe(false);
  });

  it("blocks generated-file edits and warns on unpaired UI edits", () => {
    const generatedReport = buildPreToolUseReport({
      tool_input: { path: ".codex/CLAUDE.md" },
    });
    expect(generatedReport.blocked).toContain(
      "Do not edit generated instruction shims or build artifacts by hand: .codex/CLAUDE.md.",
    );

    const uiReport = buildPreToolUseReport({
      tool_input: { path: "src/components/portal/deployment-summary.tsx" },
    });
    expect(uiReport.warnings.join("\n")).toContain("Storybook");
    expect(uiReport.warnings.join("\n")).toContain("tests");
  });

  it("prints the prompt checklist only for implementation-like prompts", () => {
    expect(buildPromptSubmitReport({ prompt: "what time is it?" }).info).toEqual([]);

    const report = buildPromptSubmitReport({
      prompt: "Please implement issue #23 and open a PR",
    });

    expect(report.info.join("\n")).toContain("TDD red");
    expect(report.info.join("\n")).toContain("nearest AGENTS.md");
    expect(report.info.join("\n")).toContain("ADR");
  });

  it("summarizes stop-time reminders from changed files", () => {
    const changedFiles: ChangedFile[] = [
      {
        path: "src/components/portal/artifact-item.tsx",
        content: 'import { Badge } from "@/components/ui/badge";\n<a href={artifact.url}>Open</a>',
      },
      { path: ".codex/AGENTS.md", status: "??", content: "# Codex\n" },
      { path: "docs/adr/0011-example.md", status: "A", content: "# ADR\n" },
    ];

    const report = buildStopReport(changedFiles);
    const warnings = report.warnings.join("\n");

    expect(warnings).toContain("Storybook");
    expect(warnings).toContain("StatusBadge");
    expect(warnings).toContain("getSafeExternalHref");
    expect(warnings).toContain("agent-docs:sync");
    expect(warnings).toContain("docs/adr/README.md");
    expect(warnings).not.toContain("Storybook inventory");
  });

  it("keeps subagent guidance concise and read-only biased", () => {
    const report = buildSubagentStartReport();

    expect(report.info.join("\n")).toContain("narrow");
    expect(report.info.join("\n")).toContain("read-only");
    expect(report.info.join("\n")).toContain("adversarial");
  });

  it("lists untracked files inside new directories without reading directories as files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "loopworks-codex-hooks-"));

    try {
      spawnSync("git", ["init"], { cwd: root, stdio: "ignore" });
      await mkdir(path.join(root, ".codex/hooks"), { recursive: true });
      await writeFile(path.join(root, ".codex/hooks/lib.ts"), "export {};\n");

      expect(listChangedFilesFromGit(root)).toEqual([
        {
          content: "export {};\n",
          path: ".codex/hooks/lib.ts",
          status: "??",
        },
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
