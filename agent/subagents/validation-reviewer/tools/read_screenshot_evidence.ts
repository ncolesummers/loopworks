import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadValidationReviewContext } from "../lib/context";

export default defineTool({
  description: "Read digest-bound screenshot references for all required responsive viewports.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }) {
    const { screenshotEvidence } = await loadValidationReviewContext(runId);
    return screenshotEvidence;
  },
});
