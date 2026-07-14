import { defineTool } from "eve/tools";
import { z } from "zod";

import { maxImplementationPatchBytes } from "../../../implementation-agent";
import { buildGitTreeEntryCommand } from "../../../lib/repository-inspection";
import { readPinnedRepositoryCommit } from "../../../lib/repository-inspection-runtime";
import { resolveImplementerFixtureMode } from "../lib/fixture-mode";
import {
  assertAllowedProductionFiles,
  assertProductionWriteNotClaimed,
  sha256,
} from "../lib/tool-policy";

const inputSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), content: z.string().max(512 * 1024) })).min(1),
  testPatchSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

function symlinkGuard(path: string): string {
  const segments = path.split("/").slice(0, -1);
  return segments
    .map(
      (_, index) => `test ! -L ${JSON.stringify(`repo/${segments.slice(0, index + 1).join("/")}`)}`,
    )
    .join(" && ");
}

export default defineTool({
  description:
    "Write complete production files and return the exact bounded production-only patch.",
  inputSchema,
  async execute(input, ctx) {
    assertAllowedProductionFiles(input.files);
    const sandbox = await ctx.getSandbox();
    const existingClaim = await sandbox.readTextFile({
      path: ".loopworks/production-write-claimed",
    });
    assertProductionWriteNotClaimed(existingClaim);
    const appliedMarker = await sandbox.readTextFile({ path: ".loopworks/test-patch-applied" });
    const applied = appliedMarker
      ? (JSON.parse(appliedMarker) as { paths?: string[]; sha256?: string })
      : {};
    if (applied.sha256 !== input.testPatchSha256 || !applied.paths) {
      throw new Error("Exact test patch must be applied before production writes.");
    }
    const fixtureMode = resolveImplementerFixtureMode().enabled;
    const pinned = fixtureMode ? "a".repeat(40) : await readPinnedRepositoryCommit(sandbox);
    if (!fixtureMode) {
      const changed = await sandbox.run({ command: "cd repo && git diff --name-only" });
      const actualPaths = changed.stdout.split(/\r?\n/).filter(Boolean).sort();
      if (JSON.stringify(actualPaths) !== JSON.stringify([...applied.paths].sort())) {
        throw new Error("Working tree contains changes outside the exact test patch.");
      }
    }
    await sandbox.writeTextFile({
      path: ".loopworks/production-write-claimed",
      content: input.testPatchSha256,
    });
    const tracked = new Map<string, boolean>();
    for (const file of input.files) {
      if (!fixtureMode) {
        const tree = await sandbox.run({ command: buildGitTreeEntryCommand(pinned, file.path) });
        tracked.set(file.path, tree.exitCode === 0 && tree.stdout.trim().length > 0);
        const guard = symlinkGuard(file.path) || "true";
        const directory = `repo/${file.path}`.slice(0, `repo/${file.path}`.lastIndexOf("/"));
        const prepared = await sandbox.run({
          command: `${guard} && mkdir -p ${JSON.stringify(directory)} && ${guard}`,
        });
        if (prepared.exitCode !== 0) throw new Error(`Unsafe symlink for ${file.path}.`);
        await sandbox.writeTextFile({ path: `repo/${file.path}`, content: file.content });
      }
    }
    const diffs = fixtureMode
      ? input.files.map((file) => {
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
      : await Promise.all(
          input.files.map(async ({ path }) => {
            const command = tracked.get(path)
              ? `cd repo && git diff --no-ext-diff --no-color ${pinned} -- ${JSON.stringify(path)}`
              : `cd repo && git diff --no-index --no-color -- /dev/null ${JSON.stringify(path)}`;
            const result = await sandbox.run({ command, abortSignal: AbortSignal.timeout(10_000) });
            if (tracked.get(path) ? result.exitCode !== 0 : ![0, 1].includes(result.exitCode)) {
              throw new Error("Production patch could not be generated safely.");
            }
            return result.stdout;
          }),
        );
    const content = diffs.join("\n");
    const byteCount = Buffer.byteLength(content);
    if (!content.trim() || byteCount > maxImplementationPatchBytes) {
      throw new Error("Production patch is empty or exceeds 512 KiB.");
    }
    const patch = {
      format: "unified-diff" as const,
      content,
      sha256: sha256(content),
      byteCount,
      paths: input.files.map(({ path }) => path),
    };
    await sandbox.writeTextFile({
      path: ".loopworks/production-patch.json",
      content: JSON.stringify({ sha256: patch.sha256, paths: patch.paths }),
    });
    return { patch };
  },
});
