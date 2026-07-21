import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read passing validation summaries and digests without raw command output.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return {
      schemaId: context.validationReport.schemaId,
      overallOutcome: context.validationReport.overallOutcome,
      counts: context.validationReport.counts,
      artifactSha256: context.validationArtifactSha256,
      results: context.validationReport.results.map(({ key, name, outcome, required, output }) => ({
        key,
        name,
        outcome,
        required,
        ...(output?.sha256 ? { outputSha256: output.sha256 } : {}),
      })),
    };
  },
});
