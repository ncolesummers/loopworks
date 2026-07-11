import { defineTool } from "eve/tools";

import { testWritingAgentOutputSchema } from "../../../test-writing-agent";

export default defineTool({
  description: "Emit the final validated test-plan and red-evidence artifacts.",
  inputSchema: testWritingAgentOutputSchema,
  outputSchema: testWritingAgentOutputSchema,
  execute: (input) => testWritingAgentOutputSchema.parse(input),
});
