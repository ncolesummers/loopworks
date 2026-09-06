/** @vitest-environment node */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
    expect(packageJson.dependencies.eve).toBe("0.51.0");
    expect(packageJson.dependencies.ai).toBe("7.0.92");
    expect(lockfile).toContain('"eve": "0.51.0"');
    expect(lockfile).toContain('"ai": "7.0.92"');
    expect(lockfile).toContain('"eve": ["eve@0.51.0"');
    expect(lockfile).toContain('"ai": ["ai@7.0.92"');
    expect(installedEvePackage.version).toBe(packageJson.dependencies.eve);
    expect(installedEvePackage.peerDependencies.ai).toBe("^7.0.82");
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

  it("compiles the real agent with guarded tools and all stage siblings", () => {
    const info = JSON.parse(
      execFileSync("bun", ["node_modules/eve/bin/eve.js", "info", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
      }),
    );
    expect(info.status).toBe("ready");
    expect(info.diagnostics).toEqual({ errors: 0, warnings: 0 });
    expect(info.subagents.sort()).toEqual([
      "implementer",
      "planner",
      "pr-preparer",
      "test-writer",
      "validation-reviewer",
    ]);
    expect(info.tools).toContain("read_run_stage_context");
    const manifest = JSON.parse(readFileSync(info.artifacts.compiledManifest, "utf8")) as {
      tools: Array<{ name: string }>;
      subagents: Array<{ name: string; agent: { tools: Array<{ name: string }> } }>;
    };
    for (const agent of [manifest, ...manifest.subagents.map((entry) => entry.agent)]) {
      const names = agent.tools.map((tool) => tool.name);
      for (const forbidden of [
        "bash",
        "glob",
        "grep",
        "write_file",
        "web_fetch",
        "web_search",
        "agent",
      ]) {
        expect(names).not.toContain(forbidden);
      }
    }
  }, 65_000);
});
