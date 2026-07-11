import { defineTool } from "eve/tools";
import { z } from "zod";
import { buildGitTreeEntryCommand } from "../../../lib/repository-inspection";
import { readPinnedRepositoryCommit } from "../../../lib/repository-inspection-runtime";
import { resolveTestWriterFixtureMode } from "../lib/fixture-mode";
import { assertAllowedTestFiles, sha256 } from "../lib/tool-policy";

const inputSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().max(256 * 1024) })).min(1),
});

function symlinkGuardCommand(path: string): string {
  const segments = path.split("/").slice(0, -1);
  const parents = segments.map((_, index) => `repo/${segments.slice(0, index + 1).join("/")}`);
  return parents.map((parent) => `test ! -L ${JSON.stringify(parent)}`).join(" && ");
}

export default defineTool({
  description: "Write only approved test, eval, fixture, or story files in the isolated checkout.",
  inputSchema,
  async execute(input, ctx) {
    assertAllowedTestFiles(input.files);
    if (resolveTestWriterFixtureMode().enabled) {
      const content = input.files
        .map((file) => {
          const lines = file.content.split("\n");
          return [
            `diff --git a/${file.path} b/${file.path}`,
            "new file mode 100644",
            "--- /dev/null",
            `+++ b/${file.path}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((line) => `+${line}`),
          ].join("\n");
        })
        .join("\n");
      const byteCount = Buffer.byteLength(content);
      if (byteCount > 256 * 1024) throw new Error("Test-only patch exceeds 256 KiB.");
      return {
        patch: {
          byteCount,
          content,
          paths: input.files.map(({ path }) => path),
          sha256: sha256(content),
        },
        written: input.files.map((file) => ({
          byteCount: Buffer.byteLength(file.content),
          path: file.path,
          sha256: sha256(file.content),
        })),
      };
    }
    const sandbox = await ctx.getSandbox();
    const pinnedCommit = await readPinnedRepositoryCommit(sandbox);
    const written = [];
    const tracked = new Map<string, boolean>();
    for (const file of input.files) {
      const treeEntry = await sandbox.run({
        command: buildGitTreeEntryCommand(pinnedCommit, file.path),
        abortSignal: AbortSignal.timeout(5_000),
      });
      tracked.set(file.path, treeEntry.exitCode === 0 && treeEntry.stdout.trim().length > 0);
      const target = `repo/${file.path}`;
      const directory = target.slice(0, target.lastIndexOf("/"));
      const ancestorGuard = symlinkGuardCommand(file.path);
      const guard = await sandbox.run({
        command: `${ancestorGuard} && mkdir -p ${JSON.stringify(directory)} && ${ancestorGuard}`,
      });
      if (guard.exitCode !== 0) throw new Error(`Unsafe symlink encountered for ${file.path}.`);
      await sandbox.writeTextFile({ path: target, content: file.content });
      written.push({
        path: file.path,
        byteCount: Buffer.byteLength(file.content),
        sha256: sha256(file.content),
      });
    }
    const paths = input.files.map(({ path }) => path);
    const check = await sandbox.run({
      command: "cd repo && git diff --check",
      abortSignal: AbortSignal.timeout(10_000),
    });
    if (check.exitCode !== 0) throw new Error("Test-only patch could not be produced safely.");
    const diffs = await Promise.all(
      paths.map(async (path) => {
        const command = tracked.get(path)
          ? `cd repo && git diff --no-ext-diff --no-color ${pinnedCommit} -- ${JSON.stringify(path)}`
          : `cd repo && git diff --no-index --no-color -- /dev/null ${JSON.stringify(path)}`;
        const result = await sandbox.run({
          command,
          abortSignal: AbortSignal.timeout(10_000),
        });
        if (tracked.get(path) ? result.exitCode !== 0 : ![0, 1].includes(result.exitCode)) {
          throw new Error("Test-only patch could not be produced safely.");
        }
        return result.stdout;
      }),
    );
    const content = diffs.join("\n");
    if (!content.trim()) {
      throw new Error("Test-only patch could not be produced safely.");
    }
    const byteCount = Buffer.byteLength(content);
    if (byteCount > 256 * 1024) throw new Error("Test-only patch exceeds 256 KiB.");
    return {
      patch: { content, sha256: sha256(content), byteCount, paths },
      written,
    };
  },
});
