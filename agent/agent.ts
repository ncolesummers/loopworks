import { defineAgent } from "eve";

export default defineAgent({
  model: "openai/gpt-5.6-sol",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: {
      openai: {
        reasoningEffort: "xhigh",
      },
    },
  },
});
