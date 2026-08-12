/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
  engines?: Record<string, string>;
  scripts: Record<string, string>;
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
const nextConfig = readFileSync(path.join(repoRoot, "next.config.ts"), "utf8");
const proxySource = readFileSync(path.join(repoRoot, "src/proxy.ts"), "utf8");
const markdownlintConfig = readFileSync(path.join(repoRoot, ".markdownlint-cli2.yaml"), "utf8");
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

  it("mounts Eve beside Next.js in the shared Vercel preview", () => {
    expect(nextConfig).toContain('import { withEve } from "eve/next"');
    expect(nextConfig).toContain("export default withEve(nextConfig)");
    expect(packageJson.scripts.build).toBe("bun run build:eve && bun run build:next");
    expect(packageJson.scripts["build:eve"]).toBe("bunx eve build");
    expect(packageJson.scripts["build:next"]).toBe("next build");
    expect(packageJson.scripts["vercel-build"]).toBe("bun run db:migrate && bun run build:next");
    expect(proxySource).toContain("(?!api|eve|_next/static");
    expect(markdownlintConfig).toContain('- ".eve"');
    expect(markdownlintConfig).toContain('- ".output"');
  });

  it("generates a sibling Eve service before Vercel filesystem routing", () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), "loopworks-eve-next-"));
    try {
      symlinkSync(
        path.join(repoRoot, "node_modules"),
        path.join(fixtureRoot, "node_modules"),
        "dir",
      );
      execFileSync(
        "bun",
        [
          "--eval",
          'import { withEve } from "eve/next"; const config = withEve({ typedRoutes: true }); await config("phase-production-build", {});',
        ],
        {
          cwd: fixtureRoot,
          env: { ...process.env, VERCEL: "1" },
          stdio: "pipe",
        },
      );

      const output = JSON.parse(
        readFileSync(path.join(fixtureRoot, ".vercel/output/config.json"), "utf8"),
      ) as {
        routes: Array<{ destination?: { service?: string; type?: string }; src?: string }>;
        services: Record<string, { framework?: string; root?: string }>;
        version: number;
      };
      expect(output.version).toBe(3);
      expect(output.services.eve).toMatchObject({ framework: "eve" });
      expect(output.services.eve.root).toContain(".eve/vercel-services/eve");
      expect(output.routes[0]).toMatchObject({
        destination: { service: "eve", type: "service" },
        src: "^/eve/v1/(.*)$",
      });
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
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
    expect(adr).toContain("same Vercel preview");
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
