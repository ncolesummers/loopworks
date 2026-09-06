/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

describe("isolated hosted Eve runtime probe", () => {
  it("compiles the isolated tool surface and requires approval for a UUID marker", () => {
    const stage = mkdtempSync(path.join(tmpdir(), "loopworks-eve-probe-test-"));
    try {
      cpSync(path.join(repoRoot, "scripts/eve-runtime-probe/agent"), path.join(stage, "agent"), {
        recursive: true,
      });
      cpSync(path.join(repoRoot, "package.json"), path.join(stage, "package.json"));
      symlinkSync(path.join(repoRoot, "node_modules"), path.join(stage, "node_modules"), "dir");
      const info = JSON.parse(
        execFileSync("node", ["node_modules/eve/bin/eve.js", "info", "--json"], {
          cwd: stage,
          encoding: "utf8",
          timeout: 60_000,
        }),
      );
      expect(info.status).toBe("ready");
      expect(info.diagnostics).toEqual({ errors: 0, warnings: 0 });
      expect(info.subagents).toEqual(["worker"]);
      const manifest = JSON.parse(readFileSync(info.artifacts.compiledManifest, "utf8"));
      expect(manifest.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
        "task_cancel",
        "task_update",
      ]);
      expect(
        manifest.subagents[0].agent.tools.map((tool: { name: string }) => tool.name).sort(),
      ).toEqual(["approved_marker", "task_cancel", "task_update"]);
      const channel = readFileSync(path.join(stage, "agent/channels/eve.ts"), "utf8");
      expect(channel).toContain("auth: [vercelOidc()]");
      expect(channel).not.toMatch(/localDev|none\(/);
      const result = JSON.parse(
        execFileSync(
          "bun",
          [
            "--eval",
            `
        import marker from "./agent/subagents/worker/tools/approved_marker.ts";
        const valid = marker.inputSchema.safeParse({marker:"914e4433-a8bd-45bd-bf7b-f26c794b6db9"});
        const invalid = marker.inputSchema.safeParse({marker:"arbitrary prompt"});
        const extra = marker.inputSchema.safeParse({marker:"914e4433-a8bd-45bd-bf7b-f26c794b6db9", command:"ignored"});
        console.log(JSON.stringify({valid:valid.success, invalid:invalid.success, extra:extra.success, approval:await marker.approval({}), result:await marker.execute(valid.data)}));
      `,
          ],
          { cwd: stage, encoding: "utf8", timeout: 30_000 },
        ),
      );
      expect(result).toEqual({
        valid: true,
        invalid: false,
        extra: false,
        approval: "user-approval",
        result: { approvedMarker: "914e4433-a8bd-45bd-bf7b-f26c794b6db9" },
      });
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }, 90_000);
});
