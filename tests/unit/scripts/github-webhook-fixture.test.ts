import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runGithubWebhookFixtureCli } from "../../../scripts/github-webhook-fixture";

describe("GitHub webhook fixture script", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is exposed through a package script", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["github:webhook-fixture"]).toBe(
      "bun run scripts/github-webhook-fixture.ts",
    );
  });

  it("prints signed dry-run metadata without exposing the webhook secret", () => {
    const scriptPath = path.join(process.cwd(), "scripts/github-webhook-fixture.ts");
    const result = spawnSync(
      "bun",
      [
        "run",
        scriptPath,
        "--kind",
        "spike-agent-ready",
        "--delivery-id",
        "dry-run-delivery",
        "--url",
        "https://loopworks.local/api/github/webhooks",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_WEBHOOK_SECRET: "super-sensitive-fixture-secret",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LoopWorks GitHub webhook fixture dry run");
    expect(result.stdout).toContain("Kind: spike-agent-ready");
    expect(result.stdout).toContain("URL: https://loopworks.local/api/github/webhooks");
    expect(result.stdout).toContain("x-github-delivery: dry-run-delivery");
    expect(result.stdout).toContain("x-github-event: issues");
    expect(result.stdout).toContain("x-hub-signature-256: sha256=");
    expect(result.stdout).toContain("Labels: agent-ready, spike, area:github, priority:p0");
    expect(result.stdout).not.toContain("super-sensitive-fixture-secret");
    expect(result.stderr).not.toContain("super-sensitive-fixture-secret");
  });

  it("refuses to send signed fixtures to non-loopback URLs", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    const status = await runGithubWebhookFixtureCli([
      "--kind",
      "agent-ready",
      "--delivery-id",
      "unsafe-send-delivery",
      "--url",
      "https://example.com/api/github/webhooks",
      "--send",
    ]);

    expect(status).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Refusing to send signed webhook fixtures to non-loopback URL: https://example.com/api/github/webhooks",
    );
  });
});
