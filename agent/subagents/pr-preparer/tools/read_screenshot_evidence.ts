import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Read exact validation-owned screenshot references without screenshot bytes.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return {
      artifactSha256: context.screenshotArtifactSha256,
      uiAffecting: context.screenshotEvidence.uiAffecting,
      browserTestIds: context.screenshotEvidence.browserTestIds,
      captures: context.screenshotEvidence.captures.map(
        ({ id, testId, viewport, width, height, uri, sha256 }) => ({
          id,
          testId,
          viewport,
          width,
          height,
          uri,
          sha256,
        }),
      ),
    };
  },
});
