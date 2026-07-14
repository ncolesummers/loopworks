import { defineTool } from "eve/tools";
import { z } from "zod";

import { loadValidationReviewContext } from "../lib/context";

export default defineTool({
  description: "Read exact acceptance mappings and functional steps from the persisted test plan.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }) {
    const { testPlan } = await loadValidationReviewContext(runId);
    return { acceptanceCriteria: testPlan.acceptanceCriteria, tests: testPlan.tests };
  },
});
