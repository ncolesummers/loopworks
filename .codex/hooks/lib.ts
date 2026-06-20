import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type HookInput = Record<string, unknown>;

export type HookReport = {
  info: string[];
  warnings: string[];
  blocked: string[];
};

export type ChangedFile = {
  path: string;
  status?: string;
  content?: string;
};

const generatedDirectoryNames = new Set([
  ".next",
  "coverage",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

const generatedFileNames = new Set(["CLAUDE.md", "next-env.d.ts", "tsconfig.tsbuildinfo"]);

const pathLikeKeys = new Set([
  "file",
  "file_path",
  "filepath",
  "filename",
  "path",
  "relative_path",
  "relativepath",
  "target",
  "target_path",
  "targetpath",
]);

const promptLikeKeys = new Set([
  "content",
  "message",
  "prompt",
  "text",
  "user_prompt",
  "userprompt",
]);

const implementationIntentPattern =
  /\b(add|build|change|commit|debug|fix|implement|issue|open a pr|pr|pull request|refactor|review|ship|update)\b/i;
const patchFileMarkerPattern = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm;

const emptyReport = (): HookReport => ({
  blocked: [],
  info: [],
  warnings: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeKey = (key: string) => key.replaceAll("-", "_").replaceAll(" ", "_").toLowerCase();

const normalizeRepoPath = (filePath: string, root = process.cwd()) => {
  const trimmed = filePath.trim().replace(/^["']|["']$/g, "");
  const relativePath = path.isAbsolute(trimmed) ? path.relative(root, trimmed) : trimmed;

  return relativePath.replaceAll(path.sep, "/").replace(/^\.\//, "");
};

const unique = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const siblingClaudePath = (agentsPath: string) => {
  const directory = path.posix.dirname(agentsPath);

  return directory === "." ? "CLAUDE.md" : `${directory}/CLAUDE.md`;
};

const formatPathList = (paths: string[]) => paths.join(", ");

const extractPatchMarkerPaths = (value: string, root: string) => {
  return [...value.matchAll(patchFileMarkerPattern)].map((match) =>
    normalizeRepoPath(match[1], root),
  );
};

const isComponentPath = (filePath: string) => {
  return /^src\/components\/.+\.(ts|tsx)$/.test(filePath);
};

const isPortalComponentPath = (filePath: string) => {
  return /^src\/components\/portal\/.+\.(ts|tsx)$/.test(filePath);
};

const isStoryOrTestPath = (filePath: string) => {
  return (
    filePath.startsWith("tests/") ||
    /\.(test|spec)\.(ts|tsx)$/.test(filePath) ||
    /\.stories\.(ts|tsx)$/.test(filePath)
  );
};

const changedPathSet = (changedFiles: ChangedFile[]) => {
  return new Set(changedFiles.map((file) => normalizeRepoPath(file.path)));
};

export const parseHookInput = (rawInput: string): HookInput => {
  const trimmed = rawInput.trim();

  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (isRecord(parsed)) {
      return parsed;
    }

    return { value: parsed };
  } catch {
    return { raw: rawInput };
  }
};

export const readStdin = async () => {
  const chunks: string[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  }

  return chunks.join("");
};

export const extractTouchedPaths = (input: unknown, root = process.cwd()) => {
  const paths: string[] = [];

  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (key && pathLikeKeys.has(normalizeKey(key))) {
        paths.push(normalizeRepoPath(value, root));
      }

      paths.push(...extractPatchMarkerPaths(value, root));

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key);
      }

      return;
    }

    if (!isRecord(value)) {
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };

  visit(input);

  return unique(paths);
};

export const isGeneratedPath = (filePath: string) => {
  const normalizedPath = normalizeRepoPath(filePath);
  const parts = normalizedPath.split("/");
  const basename = parts.at(-1);

  return (
    (basename !== undefined && generatedFileNames.has(basename)) ||
    parts.some((part) => generatedDirectoryNames.has(part)) ||
    normalizedPath.startsWith("drizzle/meta/")
  );
};

export const buildPreToolUseReport = (input: unknown): HookReport => {
  const report = emptyReport();
  const touchedPaths = extractTouchedPaths(input);
  const generatedPaths = touchedPaths.filter(isGeneratedPath);
  const componentPaths = touchedPaths.filter(isComponentPath);

  if (generatedPaths.length > 0) {
    report.blocked.push(
      `Do not edit generated instruction shims or build artifacts by hand: ${formatPathList(
        generatedPaths,
      )}.`,
    );
  }

  if (componentPaths.length > 0 && !touchedPaths.some(isStoryOrTestPath)) {
    report.warnings.push(
      "UI component edits should be paired with Storybook stories and focused tests before implementation completes.",
    );
  }

  return report;
};

const collectPromptText = (input: unknown) => {
  const values: string[] = [];

  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string") {
      if (!key || promptLikeKeys.has(normalizeKey(key))) {
        values.push(value);
      }

      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key);
      }

      return;
    }

    if (!isRecord(value)) {
      return;
    }

    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };

  visit(input);

  return values.join("\n");
};

export const buildPromptSubmitReport = (input: unknown): HookReport => {
  const report = emptyReport();
  const promptText = collectPromptText(input);

  if (!implementationIntentPattern.test(promptText)) {
    return report;
  }

  report.info.push(
    "LoopWorks workflow: keep work issue-backed, show TDD red before green, read the nearest AGENTS.md, and update docs/ADRs when expectations change.",
  );

  return report;
};

export const buildSubagentStartReport = (): HookReport => {
  const report = emptyReport();

  report.info.push(
    "LoopWorks subagents: keep scopes narrow and read-only by default; use workers only for concrete disjoint write scopes; run adversarial QA/security review before finalizing extended work.",
  );

  return report;
};

export const buildStopReport = (changedFiles: ChangedFile[]): HookReport => {
  const report = emptyReport();
  const paths = changedPathSet(changedFiles);
  const componentFiles = changedFiles.filter((file) =>
    isComponentPath(normalizeRepoPath(file.path)),
  );
  const portalFiles = changedFiles.filter((file) =>
    isPortalComponentPath(normalizeRepoPath(file.path)),
  );
  const changedInstructionFiles = changedFiles.filter((file) =>
    normalizeRepoPath(file.path).endsWith("AGENTS.md"),
  );
  const addedAdrs = changedFiles.filter((file) => {
    const normalizedPath = normalizeRepoPath(file.path);

    return (
      file.status?.includes("A") &&
      /^docs\/adr\/\d{4}-.+\.md$/.test(normalizedPath) &&
      normalizedPath !== "docs/adr/README.md"
    );
  });

  if (
    componentFiles.length > 0 &&
    !changedFiles.some((file) => /\.stories\.(ts|tsx)$/.test(file.path))
  ) {
    report.warnings.push(
      "Component changes detected; confirm Storybook stories cover important default, loading, empty, error, and disabled states.",
    );
  }

  if (componentFiles.length > 0 && !changedFiles.some((file) => isStoryOrTestPath(file.path))) {
    report.warnings.push(
      "Component changes detected; confirm focused tests or Playwright coverage exercise the user-visible behavior.",
    );
  }

  if (componentFiles.length > 0) {
    report.warnings.push(
      "Component changes detected; confirm empty arrays render explicit empty states instead of disappearing silently.",
    );
  }

  if (
    portalFiles.some(
      (file) => file.content?.includes("Badge") === true && !file.content.includes("StatusBadge"),
    )
  ) {
    report.warnings.push(
      "Portal status-like UI should use StatusBadge/STATUS_META instead of raw Badge status styling.",
    );
  }

  if (
    portalFiles.some(
      (file) =>
        file.content?.includes("href={") === true && !file.content.includes("getSafeExternalHref"),
    )
  ) {
    report.warnings.push(
      "Portal artifact, deployment, and evidence links should pass through getSafeExternalHref.",
    );
  }

  for (const file of changedInstructionFiles.filter(
    (file) => file.status?.includes("A") === true || file.status === "??",
  )) {
    const claudePath = siblingClaudePath(normalizeRepoPath(file.path));

    if (!paths.has(claudePath)) {
      report.warnings.push(
        `Instruction guide changed without ${claudePath}; run bun run agent-docs:sync.`,
      );
    }
  }

  if (addedAdrs.length > 0 && !paths.has("docs/adr/README.md")) {
    report.warnings.push("New ADR detected; update docs/adr/README.md with the ADR index entry.");
  }

  if (paths.has(".codex/hooks.json")) {
    report.warnings.push("Codex hook config changed; review and trust updated hooks with /hooks.");
  }

  return report;
};

export const getGitRoot = (cwd = process.cwd()) => {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return cwd;
  }

  return result.stdout.trim();
};

export const listChangedFilesFromGit = (root = getGitRoot()): ChangedFile[] => {
  const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const rawPath = line.slice(3);
      const changedPath = rawPath.includes(" -> ")
        ? (rawPath.split(" -> ").at(-1) ?? rawPath)
        : rawPath;
      const normalizedPath = normalizeRepoPath(changedPath, root);
      const absolutePath = path.join(root, normalizedPath);
      const content =
        existsSync(absolutePath) && statSync(absolutePath).isFile()
          ? readFileSync(absolutePath, "utf8")
          : undefined;

      return {
        content,
        path: normalizedPath,
        status,
      };
    });
};

export const formatHookReport = (title: string, report: HookReport) => {
  const lines: string[] = [];

  if (report.blocked.length > 0) {
    lines.push(`${title} blocked:`);
    lines.push(...report.blocked.map((message) => `- ${message}`));
  }

  if (report.warnings.length > 0) {
    lines.push(`${title} reminders:`);
    lines.push(...report.warnings.map((message) => `- ${message}`));
  }

  if (report.info.length > 0) {
    lines.push(`${title}:`);
    lines.push(...report.info.map((message) => `- ${message}`));
  }

  return lines.join("\n");
};
