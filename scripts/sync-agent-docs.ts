import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CLAUDE_SHIM_CONTENT = `<!-- Generated from AGENTS.md. Edit AGENTS.md and run \`bun run agent-docs:sync\`. -->
@AGENTS.md
`;

export type AgentDocIssueType =
  | "missing-claude"
  | "stale-claude"
  | "orphan-claude"
  | "symlink-instruction"
  | "wrong-case-agents"
  | "wrong-case-claude";

export type AgentDocIssue = {
  type: AgentDocIssueType;
  path: string;
  message: string;
};

export type SyncAgentDocsOptions = {
  write: boolean;
};

export type SyncAgentDocsResult = {
  ok: boolean;
  changed: string[];
  issues: AgentDocIssue[];
};

const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  "__fixtures__",
  "coverage",
  "fixtures",
  "node_modules",
  "playwright-report",
  "storybook-static",
  "test-results",
]);

type AgentDocInventory = {
  agents: string[];
  claude: string[];
  symlinkInstructions: string[];
  wrongCaseAgents: string[];
  wrongCaseClaude: string[];
};

const toPosixPath = (filePath: string) => filePath.split(path.sep).join("/");

const sortPaths = (paths: string[]) => [...paths].sort((left, right) => left.localeCompare(right));

const siblingClaudePath = (agentsPath: string) => {
  const directory = path.posix.dirname(agentsPath);

  return directory === "." ? "CLAUDE.md" : `${directory}/CLAUDE.md`;
};

const siblingAgentsPath = (claudePath: string) => {
  const directory = path.posix.dirname(claudePath);

  return directory === "." ? "AGENTS.md" : `${directory}/AGENTS.md`;
};

const scanAgentDocs = async (root: string): Promise<AgentDocInventory> => {
  const inventory: AgentDocInventory = {
    agents: [],
    claude: [],
    symlinkInstructions: [],
    wrongCaseAgents: [],
    wrongCaseClaude: [],
  };

  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          await walk(absolutePath);
        }

        continue;
      }

      if (!entry.isFile() && !entry.isSymbolicLink()) {
        continue;
      }

      const relativePath = toPosixPath(path.relative(root, absolutePath));
      const lowerName = entry.name.toLowerCase();

      if (entry.isSymbolicLink()) {
        if (lowerName === "agents.md" || lowerName === "claude.md") {
          inventory.symlinkInstructions.push(relativePath);
        }

        continue;
      }

      if (entry.name === "AGENTS.md") {
        inventory.agents.push(relativePath);
      } else if (lowerName === "agents.md") {
        inventory.wrongCaseAgents.push(relativePath);
      }

      if (entry.name === "CLAUDE.md") {
        inventory.claude.push(relativePath);
      } else if (lowerName === "claude.md") {
        inventory.wrongCaseClaude.push(relativePath);
      }
    }
  };

  await walk(root);

  return {
    agents: sortPaths(inventory.agents),
    claude: sortPaths(inventory.claude),
    symlinkInstructions: sortPaths(inventory.symlinkInstructions),
    wrongCaseAgents: sortPaths(inventory.wrongCaseAgents),
    wrongCaseClaude: sortPaths(inventory.wrongCaseClaude),
  };
};

export const discoverAgentDocs = async (root: string) => {
  const inventory = await scanAgentDocs(root);

  return inventory.agents;
};

export const checkAgentDocs = async (root: string): Promise<SyncAgentDocsResult> => {
  const inventory = await scanAgentDocs(root);
  const agents = new Set(inventory.agents);
  const claude = new Set(inventory.claude);
  const issues: AgentDocIssue[] = [];

  for (const symlinkPath of inventory.symlinkInstructions) {
    issues.push({
      type: "symlink-instruction",
      path: symlinkPath,
      message: "Instruction files must be regular files, not symlinks.",
    });
  }

  for (const agentsPath of inventory.wrongCaseAgents) {
    issues.push({
      type: "wrong-case-agents",
      path: agentsPath,
      message: "Instruction files must use canonical AGENTS.md casing.",
    });
  }

  for (const claudePath of inventory.wrongCaseClaude) {
    issues.push({
      type: "wrong-case-claude",
      path: claudePath,
      message: "Generated Claude shims must use canonical CLAUDE.md casing.",
    });
  }

  for (const agentsPath of inventory.agents) {
    const expectedClaudePath = siblingClaudePath(agentsPath);

    if (!claude.has(expectedClaudePath)) {
      issues.push({
        type: "missing-claude",
        path: expectedClaudePath,
        message: `Missing generated Claude shim for ${agentsPath}.`,
      });
      continue;
    }

    const claudeContent = await readFile(path.join(root, expectedClaudePath), "utf8");

    if (claudeContent !== CLAUDE_SHIM_CONTENT) {
      issues.push({
        type: "stale-claude",
        path: expectedClaudePath,
        message: "Generated Claude shim is stale or was edited by hand.",
      });
    }
  }

  for (const claudePath of inventory.claude) {
    const expectedAgentsPath = siblingAgentsPath(claudePath);

    if (!agents.has(expectedAgentsPath)) {
      issues.push({
        type: "orphan-claude",
        path: claudePath,
        message: `Generated Claude shim has no sibling ${expectedAgentsPath}.`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    changed: [],
    issues: [...issues].sort((left, right) => left.path.localeCompare(right.path)),
  };
};

export const syncAgentDocs = async (
  root: string,
  options: SyncAgentDocsOptions,
): Promise<SyncAgentDocsResult> => {
  if (!options.write) {
    return checkAgentDocs(root);
  }

  const inventory = await scanAgentDocs(root);

  if (inventory.symlinkInstructions.length > 0) {
    return checkAgentDocs(root);
  }

  const changed: string[] = [];

  for (const agentsPath of inventory.agents) {
    const claudePath = siblingClaudePath(agentsPath);
    const absoluteClaudePath = path.join(root, claudePath);
    let currentContent: string | undefined;

    try {
      currentContent = await readFile(absoluteClaudePath, "utf8");
    } catch {
      currentContent = undefined;
    }

    if (currentContent !== CLAUDE_SHIM_CONTENT) {
      await mkdir(path.dirname(absoluteClaudePath), { recursive: true });
      await writeFile(absoluteClaudePath, CLAUDE_SHIM_CONTENT);
      changed.push(claudePath);
    }
  }

  const result = await checkAgentDocs(root);

  return {
    ...result,
    changed: sortPaths(changed),
  };
};

const usage = `Usage: bun run scripts/sync-agent-docs.ts (--check | --write) [--root <path>]`;

const parseArgs = (args: string[]) => {
  let mode: "check" | "write" | undefined;
  let root = process.cwd();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--check") {
      mode = "check";
    } else if (arg === "--write") {
      mode = "write";
    } else if (arg === "--root") {
      const rootArg = args[index + 1];

      if (!rootArg) {
        throw new Error("--root requires a path.");
      }

      root = path.resolve(rootArg);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!mode) {
    throw new Error("Choose --check or --write.");
  }

  return { mode, root };
};

const printIssues = (issues: AgentDocIssue[]) => {
  console.error("Agent instruction docs are out of sync.");
  console.error("Run `bun run agent-docs:sync`, then address orphaned or incorrectly cased files.");

  for (const issue of issues) {
    console.error(`- ${issue.type}: ${issue.path} - ${issue.message}`);
  }
};

const runCli = async () => {
  try {
    const { mode, root } = parseArgs(process.argv.slice(2));
    const result = await syncAgentDocs(root, { write: mode === "write" });

    if (mode === "write" && result.changed.length > 0) {
      console.log("Updated generated Claude instruction shims:");

      for (const changedPath of result.changed) {
        console.log(`- ${changedPath}`);
      }
    }

    if (!result.ok) {
      printIssues(result.issues);
      process.exitCode = 1;
      return;
    }

    if (mode === "check") {
      console.log("Agent instruction docs are in sync.");
    } else if (result.changed.length === 0) {
      console.log("Generated Claude instruction shims are already in sync.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await runCli();
}
