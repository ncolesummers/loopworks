import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read completed upstream artifact links and exact digests for the PR intent.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return { artifactSetSha256: context.artifactSetSha256, artifacts: context.completedArtifacts };
  },
});
