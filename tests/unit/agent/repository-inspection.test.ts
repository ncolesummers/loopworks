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
import { sanitizeGitEnvironment } from "../../../scripts/git-environment";

const commitSha = "a".repeat(40);

const runFixtureGit = (args: string[], cwd: string, ceilingDirectory: string) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...sanitizeGitEnvironment(),
      GIT_CEILING_DIRECTORIES: ceilingDirectory,
    },
  });

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

  it("removes inherited Git routing while preserving ordinary environment values", () => {
    expect(
      sanitizeGitEnvironment({
        GIT_COMMON_DIR: "/victim/.git",
        GIT_CONFIG_COUNT: "1",
        GIT_DIR: "/victim/.git",
        GIT_INDEX_FILE: "/victim/.git/index",
        GIT_OBJECT_DIRECTORY: "/victim/.git/objects",
        GIT_WORK_TREE: "/fixture",
        PATH: "/usr/bin",
      }),
    ).toEqual({ PATH: "/usr/bin" });
  });
});

describe("repository inspection runtime", () => {
  it("reads immutable commit objects, omits symlinks, and reports exact provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "loopworks-repository-inspection-"));
    const repo = join(root, "repo");
    const victim = join(root, "victim");
    try {
      await mkdir(victim);
      await writeFile(join(victim, "baseline.txt"), "developer state\n");
      runFixtureGit(["init"], victim, root);
      runFixtureGit(["config", "user.email", "victim@example.com"], victim, root);
      runFixtureGit(["config", "user.name", "Victim"], victim, root);
      runFixtureGit(["add", "."], victim, root);
      runFixtureGit(["commit", "-m", "baseline"], victim, root);
      const victimConfig = await readFile(join(victim, ".git", "config"));
      const victimIndex = await readFile(join(victim, ".git", "index"));

      await mkdir(join(repo, "src"), { recursive: true });
      await mkdir(join(root, ".loopworks"), { recursive: true });
      await writeFile(
        join(repo, "src", "safe.ts"),
        "export const value = 'committed';\nline two\n",
      );
      await writeFile(join(repo, ".npmrc"), "token=SUPERSECRET\n");
      await symlink("safe.ts", join(repo, "src", "link.ts"));
      vi.stubEnv("GIT_DIR", join(victim, ".git"));
      vi.stubEnv("GIT_WORK_TREE", repo);
      vi.stubEnv("GIT_INDEX_FILE", join(victim, ".git", "index"));
      vi.stubEnv("GIT_OBJECT_DIRECTORY", join(victim, ".git", "objects"));
      vi.stubEnv("GIT_COMMON_DIR", join(victim, ".git"));
      const bashEnvironment = join(root, "bash-environment");
      await writeFile(
        bashEnvironment,
        "export GIT_DIR=/reintroduced-by-bash-env\nexport GIT_WORK_TREE=/reintroduced-by-bash-env\n",
      );
      vi.stubEnv("BASH_ENV", bashEnvironment);
      runFixtureGit(["init"], repo, root);
      runFixtureGit(["config", "user.email", "test@example.com"], repo, root);
      runFixtureGit(["config", "user.name", "Test"], repo, root);
      runFixtureGit(["add", "."], repo, root);
      runFixtureGit(["commit", "-m", "fixture"], repo, root);
      const pinned = runFixtureGit(["rev-parse", "HEAD"], repo, root).trim();
      expect(await readFile(join(victim, ".git", "config"))).toEqual(victimConfig);
      expect(await readFile(join(victim, ".git", "index"))).toEqual(victimIndex);
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
          const environment = sanitizeGitEnvironment();
          delete environment.BASH_ENV;
          delete environment.ENV;
          const result = spawnSync("bash", ["--noprofile", "--norc", "-c", command], {
            cwd: root,
            encoding: "utf8",
            env: {
              ...environment,
              GIT_CEILING_DIRECTORIES: root,
            },
          });
          return { exitCode: result.status ?? 1, stdout: result.stdout };
        },
      };

      await expect(
        sandbox.run({
          command:
            "if env | grep -Eq '^(GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_COMMON_DIR)='; then exit 1; fi; printf sanitized",
        }),
      ).resolves.toEqual({ exitCode: 0, stdout: "sanitized" });

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
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
