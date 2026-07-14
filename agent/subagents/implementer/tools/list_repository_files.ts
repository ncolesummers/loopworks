import { defineTool } from "eve/tools";
import { z } from "zod";
import { assertSafeRepositoryGlob } from "../../../lib/repository-inspection";
import {
  listRepositoryFiles,
  repositoryListOutputSchema,
} from "../../../lib/repository-inspection-runtime";
import { resolveImplementerFixtureMode } from "../lib/fixture-mode";

const glob = z.string().refine((value) => {
  try {
    assertSafeRepositoryGlob(value);
    return true;
  } catch {
    return false;
  }
}, "Unsafe repository glob.");

export default defineTool({
  description: "List bounded regular-file paths from the approved pinned Git commit.",
  inputSchema: z.object({ patterns: z.array(glob).min(1).max(5) }),
  outputSchema: repositoryListOutputSchema,
  async execute({ patterns }, ctx) {
    if (resolveImplementerFixtureMode().enabled) {
      return {
        commitSha: "a".repeat(40),
        fixtureMode: true,
        paths: ["AGENTS.md", "src/AGENTS.md", "src/example.ts"],
        truncated: false,
      };
    }
    return listRepositoryFiles(await ctx.getSandbox(), patterns);
  },
});
