/** @vitest-environment node */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertSafeRepositoryGlob,
  assertSafeRepositoryPath,
  assertSafeRepositorySearch,
  buildGitGrepCommand,
  buildGitListCommand,
  parseSafeRepositorySearchLines,
  truncateRepositoryInspectionOutput,
} from "@agent/lib/repository-inspection";
import {
  listRepositoryFiles,
  type RepositorySandbox,
  readRepositoryFiles,
  searchRepository,
} from "@agent/lib/repository-inspection-runtime";

const commitSha = "a".repeat(40);

describe("repository inspection policy", () => {
  it("rejects escape, secret, generated, glob-obfuscation, and shell surfaces", () => {
    expect(assertSafeRepositoryPath("src/lib/loops/manifest.ts")).toBe("src/lib/loops/manifest.ts");
    for (const path of [
      "../outside.ts",
      "C:/Windows/system.ini",
      "/etc/passwd",
      ".env.local",
      ".git/config",
      "node_modules/eve/index.ts",
      "packages/app/vendor/library.ts",
      "src//lib/file.ts",
      ".next/server/app.js",
      "secrets/private-key.pem",
    ])
      expect(() => assertSafeRepositoryPath(path)).toThrow("Unsafe repository path");

    expect(assertSafeRepositoryGlob("tests/**/*.test.ts")).toBe("tests/**/*.test.ts");
    expect(assertSafeRepositoryGlob("**/AGENTS.md")).toBe("**/AGENTS.md");
    for (const pattern of [
      "../**",
      "node_modules/**",
      "**/node_modules/**",
      ".next/**",
      "**/.env*",
      "**/.npmrc",
      "**/*.pem",
      "src/[ab].ts",
      "**/*.ts; git status",
    ])
      expect(() => assertSafeRepositoryGlob(pattern)).toThrow("Unsafe repository glob");

    expect(
      parseSafeRepositorySearchLines(
        [`${commitSha}:.npmrc:1:not-a-key:123:SUPERSECRET`],
        commitSha,
      ),
    ).toEqual([]);
  });

  it("bounds regex search and pins bounded Git-object commands", () => {
    expect(assertSafeRepositorySearch("test-writing|plan-review")).toBe("test-writing|plan-review");
    expect(() => assertSafeRepositorySearch("a".repeat(257))).toThrow("Unsafe repository search");
    expect(() => assertSafeRepositorySearch("[invalid")).toThrow("Unsafe repository search");
    expect(() => assertSafeRepositorySearch("token=$(cat .env)")).toThrow(
      "Unsafe repository search",
    );
    expect(
      buildGitGrepCommand({ commitSha, pattern: "plan-review", paths: ["src/**/*.ts"] }),
    ).toContain(`git grep -n -I -E -- 'plan-review' '${commitSha}'`);
    expect(buildGitListCommand(commitSha, ["**/AGENTS.md"])).toContain(
      `git ls-tree -r --format='%(objectmode)%x09%(path)' '${commitSha}'`,
    );
    expect(buildGitListCommand(commitSha, ["**/AGENTS.md"])).toContain("head -c 65537");
  });

  it("truncates inspection output deterministically", () => {
    expect(truncateRepositoryInspectionOutput("abcdef", 4)).toEqual({
      byteCount: 4,
      content: "abcd",
      truncated: true,
    });
  });
});

describe("repository inspection runtime", () => {
  it("reads immutable commit objects, omits symlinks, and reports exact provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "loopworks-repository-inspection-"));
    const repo = join(root, "repo");
    try {
      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(join(root, ".loopworks"), { recursive: true });
      await writeFile(
        join(repo, "src", "safe.ts"),
        "export const value = 'committed';\nline two\n",
      );
      await writeFile(join(repo, ".npmrc"), "token=SUPERSECRET\n");
      await symlink("safe.ts", join(repo, "src", "link.ts"));
      execFileSync("git", ["init"], { cwd: repo });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
      execFileSync("git", ["add", "."], { cwd: repo });
      execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo });
      const pinned = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
      }).trim();
      await writeFile(join(root, ".loopworks", "repository-commit"), pinned);
      await writeFile(join(repo, "src", "safe.ts"), "export const value = 'dirty';\n");

      const sandbox: RepositorySandbox = {
        readTextFile: async ({ path }) => {
          try {
            return await readFile(join(root, path), "utf8");
          } catch {
            return null;
          }
        },
        run: async ({ command }) => {
          const result = spawnSync("bash", ["-lc", command], { cwd: root, encoding: "utf8" });
          return { exitCode: result.status ?? 1, stdout: result.stdout };
        },
      };

      const listed = await listRepositoryFiles(sandbox, ["src/**/*.ts"]);
      expect(listed.paths).toEqual(["src/safe.ts"]);
      const searched = await searchRepository(sandbox, {
        pattern: "committed|dirty",
        paths: ["src/**/*.ts"],
      });
      expect(searched.content).toContain("src/safe.ts:1:export const value = 'committed'");
      expect(searched.content).not.toContain("dirty");
      const read = await readRepositoryFiles(sandbox, [
        { path: "src/safe.ts", startLine: 1, endLine: 2 },
      ]);
      expect(read.files[0]).toMatchObject({
        content: "export const value = 'committed';\nline two\n",
        requestedEndLine: 2,
        returnedEndLine: 2,
        truncated: false,
      });
      await expect(
        readRepositoryFiles(sandbox, [{ path: "src/link.ts", startLine: 1 }]),
      ).rejects.toThrow("symlink");
      await expect(
        readRepositoryFiles(sandbox, [{ path: "src/safe.ts", startLine: 1, endLine: 401 }]),
      ).rejects.toThrow("too large");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
