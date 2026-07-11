import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { recordDevelopmentLoopPlanArtifact } from "@/lib/loops/development-run-transitions";
import { pinnedPlanningAgentOutputSchema } from "../planning-agent";

export default defineTool({
  description: "Persist a digest-valid pinned plan and request durable plan review.",
  inputSchema: z.object({ runId: z.string().uuid(), plan: pinnedPlanningAgentOutputSchema }),
  execute: ({ plan, runId }) => recordDevelopmentLoopPlanArtifact({ database: db, plan, runId }),
});
