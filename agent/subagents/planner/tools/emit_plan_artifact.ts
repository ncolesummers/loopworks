import { defineTool } from "eve/tools";

import { pinnedPlanningAgentOutputSchema } from "../../../planning-agent";

export default defineTool({
  description: "Emit the final validated planning artifact.",
  inputSchema: pinnedPlanningAgentOutputSchema,
  outputSchema: pinnedPlanningAgentOutputSchema,
  execute: (input) => pinnedPlanningAgentOutputSchema.parse(input),
});
