import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read the latest persisted deployment context or an explicit absent state.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return context.deployment
      ? {
          recorded: true as const,
          deploymentContextSha256: context.deploymentContextSha256,
          deployment: context.deployment,
        }
      : { recorded: false as const, deploymentContextSha256: null, deployment: null };
  },
});
