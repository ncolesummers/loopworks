import { spawnSync } from "node:child_process";
import path from "node:path";

describe("review-ui script", () => {
  it("prints deterministic dry-run commands and review URLs without starting servers", () => {
    const scriptPath = path.join(process.cwd(), "scripts/review-ui.mjs");
    const result = spawnSync("bun", ["run", scriptPath, "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LoopWorks UI review dry run");
    expect(result.stdout).toContain("http://127.0.0.1:3000");
    expect(result.stdout).toContain("http://127.0.0.1:6006");
    expect(result.stdout).toContain("bun run dev:fixture");
    expect(result.stdout).toContain("bun run storybook -- --host 127.0.0.1 --no-open");
  });

  it("accepts the package-script argument separator used in validation", () => {
    const result = spawnSync("bun", ["run", "review:ui", "--", "--dry-run"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LoopWorks UI review dry run");
  });
});
