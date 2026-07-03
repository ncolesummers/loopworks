import { execFile } from "node:child_process";

const shellConstructPattern = /&&|\|\||[;|<>`$\\\n\r]/;
const redactedArgPattern = /(token|secret|password|key|authorization|credential)/i;

const readOnlyGitVerbs = new Set(["status", "log", "show", "diff", "rev-parse"]);
const readOnlyGhResources = new Map<string, Set<string>>([
  ["api", new Set(["GET", "HEAD"])],
  ["auth", new Set(["status"])],
  ["issue", new Set(["list", "status", "view"])],
  ["pr", new Set(["checks", "diff", "list", "status", "view"])],
  ["repo", new Set(["list", "view"])],
  ["run", new Set(["list", "view", "watch"])],
  ["workflow", new Set(["list", "view"])],
]);
const readOnlyAzVerbs = new Set(["list", "show"]);
const mutatingVerbs = new Set([
  "add",
  "apply",
  "approve",
  "assign",
  "cancel",
  "close",
  "comment",
  "commit",
  "create",
  "delete",
  "deploy",
  "disable",
  "edit",
  "enable",
  "install",
  "merge",
  "mv",
  "patch",
  "push",
  "rebase",
  "remove",
  "restart",
  "restore",
  "rm",
  "run",
  "set",
  "start",
  "stop",
  "sync",
  "update",
  "upload",
  "write",
]);
const forbiddenCommandFamilies = new Set([
  "bun",
  "cat",
  "chmod",
  "cp",
  "curl",
  "mkdir",
  "mv",
  "npm",
  "pnpm",
  "rm",
  "tee",
  "touch",
  "vim",
  "vi",
]);

export type CliInspectionToolContract = {
  name: "bash";
  mutates: false;
  requiresApprovalForMutation: true;
  allowedFamilies: readonly string[];
};

export type CliInspectionDecision =
  | {
      allowed: true;
      audit: {
        commandFamily: string;
        mutates: false;
        sanitizedArgs: string[];
      };
    }
  | {
      allowed: false;
      reason: string;
    };

export type ParsedCliInspectionCommand = {
  argv: string[];
};

export type CliExecutionResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
  truncated: boolean;
};

export const cliInspectionToolContract: CliInspectionToolContract = {
  name: "bash",
  mutates: false,
  requiresApprovalForMutation: true,
  allowedFamilies: ["gh", "az", "git"],
};

export function parseCliInspectionCommand(command: string): ParsedCliInspectionCommand {
  const argv: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error("Unterminated quoted argument.");
  }

  if (current) {
    argv.push(current);
  }

  return { argv };
}

function sanitizeArgs(args: string[]): string[] {
  return args.map((arg) => (redactedArgPattern.test(arg) ? "[redacted]" : arg));
}

function hasMutatingVerb(args: string[]): boolean {
  return args.some((arg) => mutatingVerbs.has(arg.toLowerCase()));
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) {
    return undefined;
  }

  const arg = args[index];
  if (arg?.startsWith(`${flag}=`)) {
    return arg.slice(flag.length + 1);
  }

  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function evaluateGhCommand(args: string[]): CliInspectionDecision {
  const [resource, action] = args;
  if (!resource) {
    return { allowed: false, reason: "gh command must include a resource." };
  }

  const allowedActions = readOnlyGhResources.get(resource);
  if (!allowedActions) {
    return { allowed: false, reason: `gh ${resource} is not in the read-only allowlist.` };
  }

  if (resource === "api") {
    const method = (getFlagValue(args, "--method") ?? "GET").toUpperCase();
    const hasImplicitPostField =
      hasFlag(args, "-f") ||
      hasFlag(args, "-F") ||
      hasFlag(args, "--field") ||
      hasFlag(args, "--raw-field") ||
      hasFlag(args, "--input");

    if (hasImplicitPostField) {
      return { allowed: false, reason: "gh api field/input flags can imply mutation." };
    }

    if (!allowedActions.has(method)) {
      return { allowed: false, reason: `gh api method ${method} is not read-only.` };
    }

    return {
      allowed: true,
      audit: {
        commandFamily: "gh",
        mutates: false,
        sanitizedArgs: sanitizeArgs(args),
      },
    };
  }

  if (!action || !allowedActions.has(action)) {
    return {
      allowed: false,
      reason: `${`gh ${resource} ${action ?? ""}`.trim()} is not read-only.`,
    };
  }

  return {
    allowed: true,
    audit: {
      commandFamily: "gh",
      mutates: false,
      sanitizedArgs: sanitizeArgs(args),
    },
  };
}

function evaluateAzCommand(args: string[]): CliInspectionDecision {
  if (hasMutatingVerb(args)) {
    return { allowed: false, reason: "az mutation verbs are blocked." };
  }

  if (!args.some((arg) => readOnlyAzVerbs.has(arg.toLowerCase()))) {
    return { allowed: false, reason: "az command must include a read-only list/show verb." };
  }

  return {
    allowed: true,
    audit: {
      commandFamily: "az",
      mutates: false,
      sanitizedArgs: sanitizeArgs(args),
    },
  };
}

function evaluateGitCommand(args: string[]): CliInspectionDecision {
  const [verb] = args;
  if (!verb || !readOnlyGitVerbs.has(verb)) {
    return { allowed: false, reason: "git command is not in the read-only allowlist." };
  }

  if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) {
    return { allowed: false, reason: "git output file flags are blocked." };
  }

  return {
    allowed: true,
    audit: {
      commandFamily: "git",
      mutates: false,
      sanitizedArgs: sanitizeArgs(args),
    },
  };
}

export function evaluateCliInspectionCommand(command: string): CliInspectionDecision {
  if (shellConstructPattern.test(command)) {
    return { allowed: false, reason: "shell constructs are blocked for planning inspection." };
  }

  let parsed: ParsedCliInspectionCommand;
  try {
    parsed = parseCliInspectionCommand(command);
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "Invalid command.",
    };
  }

  const [commandFamily, ...args] = parsed.argv;
  if (!commandFamily) {
    return { allowed: false, reason: "Command is required." };
  }

  if (forbiddenCommandFamilies.has(commandFamily)) {
    return { allowed: false, reason: `${commandFamily} is blocked for planning inspection.` };
  }

  if (commandFamily === "gh") {
    return evaluateGhCommand(args);
  }

  if (commandFamily === "az") {
    return evaluateAzCommand(args);
  }

  if (commandFamily === "git") {
    return evaluateGitCommand(args);
  }

  return { allowed: false, reason: `${commandFamily} is not an allowed planning CLI.` };
}

function truncate(value: string, maxLength = 16_000): { truncated: boolean; value: string } {
  if (value.length <= maxLength) {
    return { truncated: false, value };
  }

  return {
    truncated: true,
    value: value.slice(0, maxLength),
  };
}

export async function executeCliInspectionCommand(command: string): Promise<CliExecutionResult> {
  const decision = evaluateCliInspectionCommand(command);
  if (!decision.allowed) {
    return {
      exitCode: 126,
      stderr: decision.reason,
      stdout: "",
      truncated: false,
    };
  }

  const { argv } = parseCliInspectionCommand(command);
  const [file, ...args] = argv;
  if (!file) {
    return {
      exitCode: 126,
      stderr: "Command is required.",
      stdout: "",
      truncated: false,
    };
  }

  return new Promise((resolve) => {
    execFile(file, args, { timeout: 30_000, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
      const truncatedStdout = truncate(stdout);
      const truncatedStderr = truncate(stderr);
      const exitCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
          ? error.code
          : 0;

      resolve({
        exitCode,
        stderr: truncatedStderr.value,
        stdout: truncatedStdout.value,
        truncated: truncatedStdout.truncated || truncatedStderr.truncated,
      });
    });
  });
}
