import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  repositorySearchOutputSchema,
  searchRepository,
} from "../../../lib/repository-inspection-runtime";
import { resolveTestWriterFixtureMode } from "../lib/fixture-mode";

export default defineTool({
  description:
    "Search regular files from the approved pinned Git commit with bounded regex output.",
  inputSchema: z.object({
    pattern: z.string().min(1).max(256),
    paths: z.array(z.string()).min(1).max(5),
  }),
  outputSchema: repositorySearchOutputSchema,
  async execute(input, ctx) {
    if (resolveTestWriterFixtureMode().enabled) {
      return {
        commitSha: "a".repeat(40),
        fixtureMode: true,
        content: "tests/unit/agent/example.test.ts:1:fixture match",
        matchCount: 1,
        truncated: false,
      };
    }
    return searchRepository(await ctx.getSandbox(), input);
  },
});
