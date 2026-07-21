import { defineTool } from "eve/tools";
import { z } from "zod";

import { computePrPreparationDigest } from "../../../pr-preparation-agent";
import { loadPrPreparationContext } from "../lib/context";

export default defineTool({
  description: "Load and validate the exact PR-stage handoff without returning narrative payloads.",
  inputSchema: z.object({ runId: z.string().uuid(), runUrl: z.url() }),
  async execute({ runId, runUrl }) {
    const context = await loadPrPreparationContext(runId, runUrl);
    return {
      runId,
      prAttempt: context.prStep.attempt,
      repositoryFullName: context.run.repositoryFullName,
      commitSha: context.run.commitSha,
      planSha256: context.plan.identity.sha256,
      artifactSetSha256: context.artifactSetSha256,
      deploymentContextSha256: context.deploymentContextSha256 ?? null,
      handoffSha256: computePrPreparationDigest({
        validation: context.validationArtifactSha256,
        review: context.reviewArtifactSha256,
        screenshots: context.screenshotArtifactSha256,
      }),
    };
  },
});
