import { defineAgent } from "eve";

import { pinnedPlanningAgentOutputSchema } from "../../planning-agent";

export default defineAgent({
  description: "Create an approved executable plan artifact from durable GitHub issue context.",
  model: "openai/gpt-5.6-sol",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: { openai: { reasoningEffort: "xhigh" } },
  },
  outputSchema: pinnedPlanningAgentOutputSchema,
});
