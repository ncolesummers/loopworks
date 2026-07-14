import { defineTool } from "eve/tools";

import { implementationResultSchema } from "../../../implementation-agent";

export default defineTool({
  description: "Emit the final validated implementation patch and green evidence.",
  inputSchema: implementationResultSchema,
  outputSchema: implementationResultSchema,
  execute: (input) => implementationResultSchema.parse(input),
});
