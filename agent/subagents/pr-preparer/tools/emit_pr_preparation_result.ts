import { defineTool } from "eve/tools";
import { z } from "zod";

import { prPreparationResultSchema } from "../../../pr-preparation-agent";
import {
  createPrPreparationResultFromContext,
  loadPrPreparationContext,
  prPreparationNarrativeSchema,
} from "../lib/context";

export default defineTool({
  description: "Compose and emit the typed PR intent from exact persisted evidence.",
  inputSchema: z
    .object({ runId: z.string().uuid(), runUrl: z.url() })
    .extend(prPreparationNarrativeSchema.shape),
  outputSchema: prPreparationResultSchema,
  async execute({ runId, runUrl, title, summary }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return createPrPreparationResultFromContext(context, { title, summary });
  },
});
