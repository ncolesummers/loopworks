import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createGithubWebhookFixture,
  runGithubWebhookFixtureCli,
} from "../../../scripts/github-webhook-fixture";

const authorizedSendIdentityArgs = [
  "--repository",
  "ncolesummers/loopworks",
  "--repository-id",
  "11000001",
  "--installation-id",
  "124001",
  "--sender-id",
  "22808397",
  "--sender-login",
  "ncolesummers",
];

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
    expect(result.stdout).toContain("Repository: ncolesummers/loopworks (11000001)");
    expect(result.stdout).toContain("Installation: 124001");
    expect(result.stdout).toContain("Sender: ncolesummers (22808397)");
    expect(result.stdout).toContain("Changed label: agent-ready");
    expect(result.stdout).toContain("Issue: #43 Research loop skeleton");
    expect(result.stdout).toContain(
      "Labels: agent-ready, spike, area:loops, area:agents, loop:research, priority:p2",
    );
    expect(result.stdout).not.toContain("super-sensitive-fixture-secret");
    expect(result.stderr).not.toContain("super-sensitive-fixture-secret");
  });

  it("emits realistic immutable actor, repository, installation, and changed-label evidence", () => {
    const fixture = createGithubWebhookFixture({
      deliveryId: "realistic-fixture-delivery",
      kind: "agent-ready",
      secret: "fixture-secret",
      url: "http://127.0.0.1:3000/api/github/webhooks",
    });

    expect(fixture.payload).toMatchObject({
      action: "labeled",
      installation: { id: 124_001 },
      label: { name: "agent-ready" },
      repository: { full_name: "ncolesummers/loopworks", id: 11_000_001 },
      sender: { id: 22_808_397, login: "ncolesummers" },
    });
    expect(fixture.payload.issue.milestone).toMatchObject({ id: 31 });
  });

  it("emits matching changed-milestone evidence for final milestone activation", () => {
    const fixture = createGithubWebhookFixture({
      deliveryId: "realistic-milestone-fixture-delivery",
      kind: "milestone-agent-ready",
      secret: "fixture-secret",
      url: "http://127.0.0.1:3000/api/github/webhooks",
    });

    expect(fixture.payload).toMatchObject({
      action: "milestoned",
      milestone: { id: 31, title: "M3 Durable Loop MVP" },
    });
    expect(fixture.payload.issue.milestone).toEqual(fixture.payload.milestone);
    expect(fixture.payload).not.toHaveProperty("label");
  });

  it("requires an explicit tracked identity tuple before a local send", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "super-sensitive-fixture-secret");
    const fetchMock = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    await expect(runGithubWebhookFixtureCli(["--send"])).resolves.toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("--send requires the exact active tracked repository"),
    );
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
        ...authorizedSendIdentityArgs,
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
        ...authorizedSendIdentityArgs,
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
      ...authorizedSendIdentityArgs,
      "--send",
    ]);

    expect(status).toBe(0);
    expect(consoleLog).toHaveBeenCalledWith("GitHub webhook fixture response: 202");
    expect(consoleLog).not.toHaveBeenCalledWith(expect.stringContaining("echoed-sensitive-body"));
  });
});
