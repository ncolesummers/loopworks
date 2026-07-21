import { defineAgent } from "eve";

import { prPreparationResultSchema } from "../../pr-preparation-agent";

export default defineAgent({
  description:
    "Draft a typed PR intent from exact persisted issue, validation, review, deployment, artifact, and screenshot evidence.",
  model: "openai/gpt-5.6-terra",
  modelContextWindowTokens: 400_000,
  modelOptions: {
    providerOptions: { openai: { reasoningEffort: "xhigh" } },
  },
  outputSchema: prPreparationResultSchema,
});
