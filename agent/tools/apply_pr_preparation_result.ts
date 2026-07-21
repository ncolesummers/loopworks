import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { applyDevelopmentLoopPrPreparationResult } from "@/lib/loops/development-run-transitions";
import { logger } from "@/lib/observability/logger";
import { createPrPreparationFixtureContext } from "../pr-preparation-fixture";
import { computePrPreparationDigest, prPreparationResultSchema } from "../pr-preparation-agent";
import { createPrPreparationResultFromContext } from "../subagents/pr-preparer/lib/context";
import { resolvePrPreparerFixtureMode } from "../subagents/pr-preparer/lib/fixture-mode";

export default defineTool({
  description:
    "Persist an exact PR-preparation result through the root control plane without mutating GitHub.",
  inputSchema: z.object({
    runId: z.string().uuid(),
    runUrl: z.url(),
    output: prPreparationResultSchema,
  }),
  execute: ({ output, runId, runUrl }) => {
    if (resolvePrPreparerFixtureMode().enabled) {
      const context = createPrPreparationFixtureContext();
      const expected = createPrPreparationResultFromContext(context, output.narrative);
      if (
        runId !== context.run.id ||
        runUrl !== context.run.runUrl ||
        computePrPreparationDigest(output) !== computePrPreparationDigest(expected)
      ) {
        throw new Error("Fixture PR preparation is not bound to the exact handoff.");
      }
      return {
        intentSha256: computePrPreparationDigest(output),
        runId,
        stage: "pr" as const,
        status: "prepared" as const,
        stepId: context.prStep.id,
      };
    }
    return applyDevelopmentLoopPrPreparationResult({
      database: db,
      logger,
      output,
      runId,
      runUrl,
    });
  },
});
