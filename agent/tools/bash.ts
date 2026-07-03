import { defineTool } from "eve/tools";
import { z } from "zod";

import { executeCliInspectionCommand } from "../lib/cli-inspection";

const bashInputSchema = z.object({
  command: z.string().min(1),
});

const bashOutputSchema = z.object({
  exitCode: z.number(),
  stderr: z.string(),
  stdout: z.string(),
  truncated: z.boolean(),
});

export default defineTool({
  description:
    "Run a guarded read-only CLI inspection command for planning context. Allows audited read-only SaaS and repository inspection commands such as gh issue view, gh pr view, az account show, and git status. Rejects shell constructs, file writes, repo mutation, and SaaS mutation verbs.",
  inputSchema: bashInputSchema,
  outputSchema: bashOutputSchema,
  async execute(input) {
    return executeCliInspectionCommand(input.command);
  },
});
