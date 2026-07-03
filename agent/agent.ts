import { defineAgent } from "eve";

import { planningAgentOutputSchema } from "./planning-agent";

export default defineAgent({
  model: "openai/gpt-5.5",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: {
      openai: {
        reasoningEffort: "xhigh",
      },
    },
  },
  outputSchema: planningAgentOutputSchema,
});
