import { defineAgent } from "eve";

import { implementationResultSchema } from "../../implementation-agent";

export default defineAgent({
  description: "Implement the smallest production change that turns an approved test plan green.",
  model: "openai/gpt-5.6-terra",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: { openai: { reasoningEffort: "xhigh" } },
  },
  outputSchema: implementationResultSchema,
});
