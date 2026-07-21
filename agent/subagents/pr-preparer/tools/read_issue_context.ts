import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read bounded source issue and Loopworks run links for the PR intent.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const { run } = await loadPrPreparationContext(runId, runUrl);
    return {
      issue: { number: run.issueNumber, title: run.issueTitle, url: run.issueUrl },
      run: { id: run.id, url: run.runUrl },
    };
  },
});
