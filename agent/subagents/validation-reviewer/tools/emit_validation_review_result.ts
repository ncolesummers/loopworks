import { defineTool } from "eve/tools";

import { validationReviewResultSchema } from "../../../validation-review-agent";

export default defineTool({
  description:
    "Validate and emit typed evidence-citing review notes and one routing recommendation.",
  inputSchema: validationReviewResultSchema,
  outputSchema: validationReviewResultSchema,
  execute(input) {
    return validationReviewResultSchema.parse(input);
  },
});
