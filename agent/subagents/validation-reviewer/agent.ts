import { defineAgent } from "eve";

import { validationReviewResultSchema } from "../../validation-review-agent";

export default defineAgent({
  description:
    "Review deterministic validation, implementation, test-plan, and screenshot evidence and recommend the next development-loop stage.",
  model: "openai/gpt-5.6-terra",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: { openai: { reasoningEffort: "xhigh" } },
  },
  outputSchema: validationReviewResultSchema,
});
