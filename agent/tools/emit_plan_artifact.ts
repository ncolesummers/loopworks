import { defineTool } from "eve/tools";

import { planningAgentOutputSchema } from "../planning-agent";

export default defineTool({
  description:
    "Emit the final validated planning agent artifact. This is the only planning tool whose contract produces a write-like artifact.",
  inputSchema: planningAgentOutputSchema,
  outputSchema: planningAgentOutputSchema,
  execute(input) {
    return planningAgentOutputSchema.parse(input);
  },
});
