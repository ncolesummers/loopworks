import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read bounded validation-review findings and the commit recommendation.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return {
      artifactSha256: context.reviewArtifactSha256,
      findings: context.validationReviewResult.findings.map(
        ({ id, severity, category, summary, path, line }) => ({
          id,
          severity,
          category,
          summary,
          ...(path ? { path } : {}),
          ...(line ? { line } : {}),
        }),
      ),
      recommendation: context.validationReviewResult.recommendation,
    };
  },
});
