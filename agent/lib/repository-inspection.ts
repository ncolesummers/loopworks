const forbiddenInputPattern = /[;|&`$<>\n\r\0]/;
const forbiddenSearchPattern = /[;&`$<>\n\r\0]/;
const simpleGlobPattern = /^[A-Za-z0-9._/*-]+$/;
const excludedRootPattern =
  /(?:^|\/)(?:\.git|\.next|node_modules|coverage|storybook-static|dist|build|out|vendor)(?:\/|$)/;
const secretPathPattern =
  /(?:^|\/)(?:\.env[^/]*|\.npmrc|\.netrc|\.ssh|\.aws|secrets?|credentials?)(?:\/|$)|\.(?:pem|p12|key)$/i;

export const repositoryCommitPattern = /^[a-f0-9]{40}$/;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function assertPinnedRepositoryCommit(value: string | null): string {
  const commitSha = value?.trim() ?? "";
  if (!repositoryCommitPattern.test(commitSha)) {
    throw new Error("Repository context is not pinned to a valid commit.");
  }
  return commitSha;
}

export function assertSafeRepositoryPath(value: string): string {
  const path = value.trim().replaceAll("\\", "/");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:\//.test(path) ||
    path.includes("//") ||
    path.split("/").includes(".") ||
    path.startsWith(":") ||
    path.split("/").includes("..") ||
    forbiddenInputPattern.test(path) ||
    excludedRootPattern.test(path) ||
    secretPathPattern.test(path)
  ) {
    throw new Error(`Unsafe repository path: ${value}`);
  }
  return path;
}

export function assertSafeRepositoryGlob(value: string): string {
  const pattern = value.trim().replaceAll("\\", "/");
  if (
    !pattern ||
    pattern.length > 256 ||
    !simpleGlobPattern.test(pattern) ||
    pattern.startsWith("/") ||
    /^[A-Za-z]:\//.test(pattern) ||
    pattern.includes("//") ||
    pattern.startsWith(":") ||
    pattern.split("/").includes("..") ||
    forbiddenInputPattern.test(pattern) ||
    excludedRootPattern.test(pattern.replaceAll("*", "")) ||
    secretPathPattern.test(pattern.replaceAll("*", "")) ||
    /(?:^|\/)\*+\/(?:\.env|\.npmrc|\.netrc|\.ssh|\.aws|secrets?|credentials?)(?:[^/]*)(?:\/|$)/i.test(
      pattern,
    ) ||
    /\.(?:pem|p12|key)$/i.test(pattern)
  ) {
    throw new Error(`Unsafe repository glob: ${value}`);
  }
  return pattern;
}

export function assertSafeRepositorySearch(value: string): string {
  const pattern = value.trim();
  if (!pattern || pattern.length > 256 || forbiddenSearchPattern.test(pattern)) {
    throw new Error("Unsafe repository search pattern.");
  }
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("Unsafe repository search pattern.");
  }
  return pattern;
}

function pathspecs(patterns: readonly string[]): string {
  return patterns
    .map((pattern) => shellQuote(`:(glob)${assertSafeRepositoryGlob(pattern)}`))
    .join(" ");
}

function globToExtendedRegex(patternValue: string): string {
  const pattern = assertSafeRepositoryGlob(patternValue);
  let result = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        result += "(.*/)?";
        index += 2;
      } else {
        result += ".*";
        index += 1;
      }
    } else if (character === "*") {
      result += "[^/]*";
    } else if (character === ".") {
      result += "\\.";
    } else {
      result += character;
    }
  }
  return result;
}

export function buildGitListCommand(commitSha: string, patterns: readonly string[]): string {
  const commit = shellQuote(assertPinnedRepositoryCommit(commitSha));
  const matcher = shellQuote(
    `^[0-9]{6}[[:space:]](${patterns.map(globToExtendedRegex).join("|")})$`,
  );
  return `cd repo && git ls-tree -r --format='%(objectmode)%x09%(path)' ${commit} | grep -E ${matcher} | head -n 1001 | head -c 65537`;
}

export function buildGitGrepCommand(input: {
  commitSha: string;
  pattern: string;
  paths: readonly string[];
}): string {
  const commit = shellQuote(assertPinnedRepositoryCommit(input.commitSha));
  const pattern = shellQuote(assertSafeRepositorySearch(input.pattern));
  return `cd repo && git grep -n -I -E -- ${pattern} ${commit} -- ${pathspecs(input.paths)} | head -n 101 | head -c 65537`;
}

export function buildGitTreeEntryCommand(commitSha: string, pathValue: string): string {
  const commit = shellQuote(assertPinnedRepositoryCommit(commitSha));
  const path = shellQuote(assertSafeRepositoryPath(pathValue));
  return `cd repo && git ls-tree ${commit} -- ${path}`;
}

export function buildGitReadCommand(input: {
  commitSha: string;
  path: string;
  startLine: number;
  endLine: number;
  maxBytes: number;
}): string {
  const commit = assertPinnedRepositoryCommit(input.commitSha);
  const path = assertSafeRepositoryPath(input.path);
  return `cd repo && git show ${shellQuote(`${commit}:${path}`)} | sed -n '${input.startLine},${input.endLine}p' | head -c ${input.maxBytes + 1}`;
}

export function parseSafeGitTreePaths(lines: readonly string[], limit = 200): string[] {
  const safe: string[] = [];
  for (const line of lines) {
    const match = line.match(/^(\d{6})\t(.+)$/);
    if (!match?.[2] || match[1] === "120000") continue;
    try {
      safe.push(assertSafeRepositoryPath(match[2]));
    } catch {
      // Omit generated, dependency, secret-like, malformed, and symlink entries.
    }
    if (safe.length >= limit) break;
  }
  return safe;
}

export function parseSafeRepositorySearchLines(
  lines: readonly string[],
  commitSha: string,
  limit = 100,
): Array<{ path: string; line: string }> {
  const safe: Array<{ path: string; line: string }> = [];
  const prefix = `${assertPinnedRepositoryCommit(commitSha)}:`;
  for (const rawLine of lines) {
    if (!rawLine.startsWith(prefix)) continue;
    const line = rawLine.slice(prefix.length);
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    if (!match?.[1]) continue;
    try {
      safe.push({ path: assertSafeRepositoryPath(match[1]), line });
    } catch {
      // Never return matches from excluded or secret-like paths.
    }
    if (safe.length >= limit) break;
  }
  return safe;
}

export function isSafeNonSymlinkTreeEntry(value: string, expectedPath: string): boolean {
  const match = value.trim().match(/^(\d{6})\s+\w+\s+[a-f0-9]+\t(.+)$/);
  return Boolean(match && match[1] !== "120000" && match[2] === expectedPath);
}

export function truncateRepositoryInspectionOutput(value: string, maxBytes = 64 * 1024) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) {
    return { byteCount: bytes.byteLength, content: value, truncated: false };
  }
  const content = bytes.subarray(0, maxBytes).toString("utf8");
  return { byteCount: Buffer.byteLength(content), content, truncated: true };
}

export function redactRepositoryInspectionOutput(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
}
