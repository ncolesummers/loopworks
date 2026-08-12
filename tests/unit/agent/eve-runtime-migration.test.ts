import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  engines?: Record<string, string>;
};
const installedEvePackage = JSON.parse(
  readFileSync(path.join(repoRoot, "node_modules/eve/package.json"), "utf8"),
) as {
  engines: Record<string, string>;
  peerDependencies: Record<string, string>;
  version: string;
};
const lockfile = readFileSync(path.join(repoRoot, "bun.lock"), "utf8");
const migrationAdrPath = path.join(
  repoRoot,
  "docs/adr/0029-eve-runtime-migration-and-session-cutover.md",
);
const skillPath = path.join(repoRoot, "agent/skills/eve/SKILL.md");
const clientSessionsDeclaration = readFileSync(
  path.join(repoRoot, "node_modules/eve/dist/src/client/sessions.d.ts"),
  "utf8",
);
const clientSessionDeclaration = readFileSync(
  path.join(repoRoot, "node_modules/eve/dist/src/client/session.d.ts"),
  "utf8",
);

describe("Eve runtime migration contract", () => {
  it("pins the selected Eve and AI SDK releases exactly", () => {
    expect(packageJson.dependencies.eve).toBe("0.33.2");
    expect(packageJson.dependencies.ai).toBe("7.0.58");
    expect(lockfile).toContain('"eve": "0.33.2"');
    expect(lockfile).toContain('"ai": "7.0.58"');
    expect(lockfile).toContain('"eve": ["eve@0.33.2"');
    expect(lockfile).toContain('"ai": ["ai@7.0.58"');
    expect(installedEvePackage.version).toBe(packageJson.dependencies.eve);
    expect(installedEvePackage.peerDependencies.ai).toBe("^7.0.58");
    expect(packageJson.engines?.node).toBe(installedEvePackage.engines.node);
  });

  it("verifies the installed fixed-session client surface", () => {
    expect(clientSessionsDeclaration).toContain("create<TOutput = unknown>(input: SendTurnInput");
    expect(clientSessionsDeclaration).toContain("attach(sessionId: string");
    expect(clientSessionDeclaration).toContain("send<TOutput = unknown>(message:");
    expect(clientSessionDeclaration).toContain("respond<TOutput = unknown>(inputResponses:");
  });

  it("records the selection rationale and old-session cutover", () => {
    expect(existsSync(migrationAdrPath), "missing Eve migration ADR").toBe(true);
    if (!existsSync(migrationAdrPath)) return;

    const adr = readFileSync(migrationAdrPath, "utf8");
    expect(adr).toContain("Status: Proposed");
    expect(adr).toContain("2026-08-11");
    expect(adr).toContain("eve@0.33.2");
    expect(adr).toContain("ai@7.0.58");
    expect(adr).toContain("Node.js 24");
    expect(adr).toContain("0.22.5");
    expect(adr).toContain("0.30.3–0.30.8");
    expect(adr).toContain("must be replaced");
    expect(adr).toContain("drain");
    expect(adr).toContain("new session");
    expect(adr).toContain("subagent handoff");
    expect(adr).toContain("cancellation and approval");
    expect(adr).toContain('turnPolicy: "steer"');
    expect(adr).toContain('turnPolicy: "queue"');
    expect(adr).toMatch(/completed\s+side effects\s+are not\s+rolled back/i);
    expect(adr).toContain("Codex session plugin");
  });

  it("keeps the repo-local skill aligned with the fixed-session APIs and Bun", () => {
    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toContain("client.sessions.create");
    expect(skill).toContain("client.sessions.attach");
    expect(skill).toContain("send(message, options)");
    expect(skill).toContain("respond(inputResponses, options)");
    expect(skill).toContain("bunx eve");
    expect(skill).toContain("bun add --exact eve@0.33.2 ai@7.0.58");
    expect(skill).not.toContain("bun add eve");
    expect(skill).toContain('turnPolicy: "steer"');
    expect(skill).toContain('turnPolicy: "queue"');
    expect(skill).toMatch(/completed\s+side effects\s+are not\s+rolled back/i);
  });
});
