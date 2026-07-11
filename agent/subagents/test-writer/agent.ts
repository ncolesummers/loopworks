import { defineAgent } from "eve";

import { testWritingAgentOutputSchema } from "../../test-writing-agent";

export default defineAgent({
  description: "Write focused failing tests from an approved plan and emit reusable red evidence.",
  model: "openai/gpt-5.6-terra",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: { openai: { reasoningEffort: "xhigh" } },
  },
  outputSchema: testWritingAgentOutputSchema,
});
