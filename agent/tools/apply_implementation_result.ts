import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { applyDevelopmentLoopImplementationResult } from "@/lib/loops/development-run-transitions";
import { computeImplementationDigest, implementationResultSchema } from "../implementation-agent";
import { createImplementationFixtureHandoff } from "../implementation-fixture";
import { computeTestPlanDigest } from "../test-writing-agent";
import { resolveImplementerFixtureMode } from "../subagents/implementer/lib/fixture-mode";
import { verifyImplementationExecutionReceipt } from "../subagents/implementer/lib/tool-policy";

export default defineTool({
  description: "Persist a verified implementation patch and advance the durable run to validation.",
  inputSchema: z.object({ runId: z.string().uuid(), output: implementationResultSchema }),
  execute: ({ output, runId }) => {
    const parsed = implementationResultSchema.parse(output);
    if (resolveImplementerFixtureMode().enabled) {
      const handoff = createImplementationFixtureHandoff();
      const expectedBinding = {
        planId: handoff.plan.identity.id,
        planSha256: handoff.plan.identity.sha256,
        testPlanSha256: computeTestPlanDigest(handoff.testPlan),
        testPatchSha256: handoff.testPlan.patch.sha256,
        fixturesSha256: computeImplementationDigest(handoff.testPlan.fixtures),
        repositoryFullName: handoff.plan.issue.repositoryFullName,
        commitSha: handoff.plan.repositoryRevision?.commitSha,
      };
      if (JSON.stringify(parsed.binding) !== JSON.stringify(expectedBinding)) {
        throw new Error("Fixture implementation result is not bound to the exact handoff.");
      }
      const secret = process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET;
      if (!secret) throw new Error("Implementation execution receipt secret is not configured.");
      for (const evidence of parsed.greenEvidence) {
        if (
          !verifyImplementationExecutionReceipt(
            {
              kind: "focused",
              command: evidence.command,
              exitCode: evidence.exitCode,
              outcome: evidence.outcome,
              outputSha256: evidence.outputReference.sha256,
              planSha256: parsed.binding.planSha256,
              testPlanSha256: parsed.binding.testPlanSha256,
              testPatchSha256: parsed.binding.testPatchSha256,
              productionPatchSha256: parsed.patch.sha256,
              testPaths: [evidence.testPath],
            },
            evidence.executionReceipt,
            secret,
          )
        ) {
          throw new Error(`Invalid implementation receipt for ${evidence.testId}.`);
        }
      }
      const validation = parsed.validationEvidence;
      if (
        !verifyImplementationExecutionReceipt(
          {
            kind: "aggregate",
            command: validation.command,
            exitCode: validation.exitCode,
            outcome: validation.outcome,
            outputSha256: validation.outputReference.sha256,
            planSha256: parsed.binding.planSha256,
            testPlanSha256: parsed.binding.testPlanSha256,
            testPatchSha256: parsed.binding.testPatchSha256,
            productionPatchSha256: parsed.patch.sha256,
            testPaths: [],
          },
          validation.executionReceipt,
          secret,
        )
      ) {
        throw new Error("Invalid aggregate implementation receipt.");
      }
      return {
        persistedArtifactTypes: ["patch"],
        runId,
        stage: "development" as const,
        status: "advanced" as const,
        stepId: "00000000-0000-4000-8000-000000000348",
      };
    }
    return applyDevelopmentLoopImplementationResult({ database: db, output: parsed, runId });
  },
});
