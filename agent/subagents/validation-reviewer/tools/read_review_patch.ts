import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadValidationReviewContext } from "../lib/context";

export default defineTool({
  description: "Read the exact bounded production patch persisted by the implementation stage.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }) {
    const { implementationResult } = await loadValidationReviewContext(runId);
    return { patch: implementationResult.patch };
  },
});
