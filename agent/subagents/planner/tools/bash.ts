import { defineTool } from "eve/tools";
import { z } from "zod";

import { executeCliInspectionCommand } from "../../../lib/cli-inspection";

export default defineTool({
  description: "Run a guarded read-only CLI inspection command for planning context.",
  inputSchema: z.object({ command: z.string().min(1) }),
  outputSchema: z.object({
    exitCode: z.number(),
    stderr: z.string(),
    stdout: z.string(),
    truncated: z.boolean(),
  }),
  execute: ({ command }) => executeCliInspectionCommand(command),
});
