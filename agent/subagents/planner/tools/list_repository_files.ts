import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolvePlanningAgentFixtureMode } from "../../../lib/fixture-mode";
import { assertSafeRepositoryGlob } from "../../../lib/repository-inspection";
import {
  listRepositoryFiles,
  repositoryListOutputSchema,
} from "../../../lib/repository-inspection-runtime";

const glob = z.string().refine((value) => {
  try {
    assertSafeRepositoryGlob(value);
    return true;
  } catch {
    return false;
  }
}, "Unsafe repository glob.");

export default defineTool({
  description: "List bounded regular-file paths from the prepared pinned Git commit.",
  inputSchema: z.object({ patterns: z.array(glob).min(1).max(5) }),
  outputSchema: repositoryListOutputSchema,
  async execute({ patterns }, ctx) {
    if (resolvePlanningAgentFixtureMode().enabled) {
      return {
        commitSha: "a".repeat(40),
        fixtureMode: true,
        paths: ["AGENTS.md", "agent/AGENTS.md", "tests/AGENTS.md"],
        truncated: false,
      };
    }
    return listRepositoryFiles(await ctx.getSandbox(), patterns);
  },
});
