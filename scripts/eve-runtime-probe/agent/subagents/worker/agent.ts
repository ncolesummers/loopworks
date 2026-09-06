import { defineAgent } from "eve";

export default defineAgent({
  description: "Run one harmless approval-gated marker probe and report the actual tool result.",
  model: "openai/gpt-5.6-sol",
  modelContextWindowTokens: 400_000,
  reasoning: "low",
  limits: {
    maxInputTokensPerSession: 40_000,
    maxOutputTokensPerSession: 4_000,
    sessionTimeoutMs: 900_000,
  },
});
