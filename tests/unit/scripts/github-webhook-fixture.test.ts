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

  it("refuses deceptive 127-prefixed hostnames that are not loopback addresses", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      text: async () => "",
    }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    const status = await runGithubWebhookFixtureCli([
      "--kind",
      "agent-ready",
      "--delivery-id",
      "deceptive-host-delivery",
      "--url",
      "https://127.evil.com/api/github/webhooks",
      "--send",
    ]);

    expect(status).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "Refusing to send signed webhook fixtures to non-loopback URL: https://127.evil.com/api/github/webhooks",
    );
  });

  it("prints an actionable failure when sending cannot reach the local server", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runGithubWebhookFixtureCli([
        "--kind",
        "agent-ready",
        "--delivery-id",
        "unreachable-server-delivery",
        "--url",
        "http://127.0.0.1:3000/api/github/webhooks",
        "--send",
      ]),
    ).resolves.toBe(1);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to reach http://127.0.0.1:3000/api/github/webhooks: connect ECONNREFUSED 127.0.0.1:3000.",
      ),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.not.stringContaining("super-sensitive-fixture-secret"),
    );
  });

  it("does not print URL credentials when a local send fails", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      runGithubWebhookFixtureCli([
        "--kind",
        "agent-ready",
        "--delivery-id",
        "credentialed-local-url-delivery",
        "--url",
        "http://fixture-user:fixture-pass@127.0.0.1:3000/api/github/webhooks",
        "--send",
      ]),
    ).resolves.toBe(1);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("http://127.0.0.1:3000/api/github/webhooks"),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.not.stringContaining("fixture-user"));
    expect(consoleError).toHaveBeenCalledWith(expect.not.stringContaining("fixture-pass"));
  });

  it("does not print arbitrary webhook response bodies from signed sends", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      text: async () => '{"rawWebhookBody":"echoed-sensitive-body"}',
    }));
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    const status = await runGithubWebhookFixtureCli([
      "--kind",
      "agent-ready",
      "--delivery-id",
      "response-body-redaction-delivery",
      "--url",
      "http://127.0.0.1:3000/api/github/webhooks",
      "--send",
    ]);

    expect(status).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith("GitHub webhook fixture response: 202");
    expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining("echoed-sensitive-body"));
  });
});
