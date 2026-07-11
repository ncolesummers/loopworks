import { z } from "zod";

import {
  assertPinnedRepositoryCommit,
  assertSafeRepositoryGlob,
  assertSafeRepositoryPath,
  assertSafeRepositorySearch,
  buildGitGrepCommand,
  buildGitListCommand,
  buildGitReadCommand,
  buildGitTreeEntryCommand,
  isSafeNonSymlinkTreeEntry,
  parseSafeGitTreePaths,
  parseSafeRepositorySearchLines,
  redactRepositoryInspectionOutput,
  truncateRepositoryInspectionOutput,
} from "./repository-inspection";

type RunResult = { exitCode: number; stdout: string };
export type RepositorySandbox = {
  readTextFile(input: { path: string }): PromiseLike<string | null>;
  run(input: { command: string; abortSignal?: AbortSignal }): PromiseLike<RunResult>;
};

const commitSha = z.string().regex(/^[a-f0-9]{40}$/);
const fileResult = z.object({
  path: z.string(),
  startLine: z.number().int().positive(),
  requestedEndLine: z.number().int().positive(),
  returnedEndLine: z.number().int().nonnegative(),
  content: z.string(),
  truncated: z.boolean(),
});

export const repositoryListOutputSchema = z.object({
  commitSha,
  fixtureMode: z.boolean(),
  paths: z.array(z.string()),
  truncated: z.boolean(),
});
export const repositorySearchOutputSchema = z.object({
  commitSha,
  fixtureMode: z.boolean(),
  content: z.string(),
  matchCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export const repositoryReadOutputSchema = z.object({
  commitSha,
  fixtureMode: z.boolean(),
  files: z.array(fileResult),
  truncated: z.boolean(),
});

export async function readPinnedRepositoryCommit(sandbox: RepositorySandbox): Promise<string> {
  return assertPinnedRepositoryCommit(
    await sandbox.readTextFile({ path: ".loopworks/repository-commit" }),
  );
}

export async function listRepositoryFiles(sandbox: RepositorySandbox, patterns: readonly string[]) {
  patterns.forEach(assertSafeRepositoryGlob);
  const pinned = await readPinnedRepositoryCommit(sandbox);
  const listing = await sandbox.run({
    command: buildGitListCommand(pinned, patterns),
    abortSignal: AbortSignal.timeout(10_000),
  });
  if (listing.exitCode !== 0) throw new Error("Repository listing failed.");
  const rawLines = listing.stdout.split(/\r?\n/).filter(Boolean);
  const paths = parseSafeGitTreePaths(rawLines);
  return {
    commitSha: pinned,
    fixtureMode: false,
    paths,
    truncated: Buffer.byteLength(listing.stdout) > 64 * 1024 || rawLines.length > paths.length,
  };
}

export async function searchRepository(
  sandbox: RepositorySandbox,
  input: { pattern: string; paths: readonly string[] },
) {
  assertSafeRepositorySearch(input.pattern);
  input.paths.forEach(assertSafeRepositoryGlob);
  const pinned = await readPinnedRepositoryCommit(sandbox);
  const search = await sandbox.run({
    command: buildGitGrepCommand({ ...input, commitSha: pinned }),
    abortSignal: AbortSignal.timeout(10_000),
  });
  if (![0, 1].includes(search.exitCode)) throw new Error("Repository search failed.");
  const rawLines = search.stdout.split(/\r?\n/).filter(Boolean);
  const parsed = parseSafeRepositorySearchLines(rawLines, pinned);
  const paths = [...new Set(parsed.map(({ path }) => path))];
  const treeEntries = await Promise.all(
    paths.map(async (path) => {
      const result = await sandbox.run({
        command: buildGitTreeEntryCommand(pinned, path),
        abortSignal: AbortSignal.timeout(5_000),
      });
      return [path, result] as const;
    }),
  );
  const safePaths = new Set(
    treeEntries
      .filter(
        ([path, result]) => result.exitCode === 0 && isSafeNonSymlinkTreeEntry(result.stdout, path),
      )
      .map(([path]) => path),
  );
  const safeLines = parsed.filter(({ path }) => safePaths.has(path)).map(({ line }) => line);
  const output = truncateRepositoryInspectionOutput(
    redactRepositoryInspectionOutput(safeLines.join("\n")),
  );
  return {
    commitSha: pinned,
    fixtureMode: false,
    content: output.content,
    matchCount: safeLines.length,
    truncated:
      output.truncated ||
      Buffer.byteLength(search.stdout) > 64 * 1024 ||
      rawLines.length > safeLines.length,
  };
}

export async function readRepositoryFiles(
  sandbox: RepositorySandbox,
  files: readonly { path: string; startLine: number; endLine?: number }[],
) {
  const normalized = files.map((entry) => ({
    ...entry,
    path: assertSafeRepositoryPath(entry.path),
  }));
  for (const entry of normalized) {
    const requestedEndLine = entry.endLine ?? entry.startLine + 399;
    if (requestedEndLine < entry.startLine || requestedEndLine - entry.startLine + 1 > 400) {
      throw new Error("Repository read range is invalid or too large.");
    }
  }
  const pinned = await readPinnedRepositoryCommit(sandbox);
  const results = [];
  let remainingBytes = 64 * 1024;
  let truncated = false;
  for (const entry of normalized) {
    const requestedEndLine = entry.endLine ?? entry.startLine + 399;
    const tree = await sandbox.run({
      command: buildGitTreeEntryCommand(pinned, entry.path),
      abortSignal: AbortSignal.timeout(5_000),
    });
    if (tree.exitCode !== 0 || !isSafeNonSymlinkTreeEntry(tree.stdout, entry.path)) {
      throw new Error(`Repository file ${entry.path} is missing or is a symlink.`);
    }
    const maxBytes = Math.min(32 * 1024, remainingBytes);
    const read = await sandbox.run({
      command: buildGitReadCommand({
        commitSha: pinned,
        path: entry.path,
        startLine: entry.startLine,
        endLine: requestedEndLine,
        maxBytes,
      }),
      abortSignal: AbortSignal.timeout(10_000),
    });
    if (read.exitCode !== 0) throw new Error(`Repository file ${entry.path} could not be read.`);
    const bounded = truncateRepositoryInspectionOutput(
      redactRepositoryInspectionOutput(read.stdout),
      maxBytes,
    );
    const newlineCount = (bounded.content.match(/\n/g) ?? []).length;
    const returnedLineCount =
      bounded.content.length === 0 ? 0 : newlineCount + (bounded.content.endsWith("\n") ? 0 : 1);
    const returnedEndLine =
      returnedLineCount === 0 ? entry.startLine - 1 : entry.startLine + returnedLineCount - 1;
    const fileTruncated = bounded.truncated || Buffer.byteLength(read.stdout) > maxBytes;
    remainingBytes -= bounded.byteCount;
    truncated ||= fileTruncated;
    results.push({
      path: entry.path,
      startLine: entry.startLine,
      requestedEndLine,
      returnedEndLine,
      content: bounded.content,
      truncated: fileTruncated,
    });
    if (remainingBytes <= 0) {
      truncated = true;
      break;
    }
  }
  return { commitSha: pinned, fixtureMode: false, files: results, truncated };
}
