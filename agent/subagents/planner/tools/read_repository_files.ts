import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolvePlanningAgentFixtureMode } from "../../../lib/fixture-mode";
import {
  readRepositoryFiles,
  repositoryReadOutputSchema,
} from "../../../lib/repository-inspection-runtime";

const request = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    startLine: z.number().int().positive().default(1),
    endLine: z.number().int().positive().optional(),
  }),
]);

export default defineTool({
  description: "Read bounded line ranges from regular files at the pinned Git commit.",
  inputSchema: z.object({ files: z.array(request).min(1).max(20) }),
  outputSchema: repositoryReadOutputSchema,
  async execute({ files }, ctx) {
    const normalized = files.map((entry) =>
      typeof entry === "string" ? { path: entry, startLine: 1 } : entry,
    );
    if (resolvePlanningAgentFixtureMode().enabled) {
      return {
        commitSha: "a".repeat(40),
        fixtureMode: true,
        files: normalized.map((entry) => ({
          path: entry.path,
          startLine: entry.startLine,
          requestedEndLine: entry.endLine ?? entry.startLine + 399,
          returnedEndLine: entry.startLine,
          content: "// Deterministic fixture repository context.",
          truncated: false,
        })),
        truncated: false,
      };
    }
    return readRepositoryFiles(await ctx.getSandbox(), normalized);
  },
});
