import { defineTool } from "eve/tools";
import { z } from "zod";

import { db } from "@/db/client";
import { applyDevelopmentLoopTestWritingResult } from "@/lib/loops/development-run-transitions";
import { resolveTestWriterFixtureMode } from "../subagents/test-writer/lib/fixture-mode";
import { verifyTestExecutionReceipt } from "../subagents/test-writer/lib/tool-policy";
import { testWritingAgentOutputSchema } from "../test-writing-agent";

export default defineTool({
  description: "Persist validated expected-red artifacts and advance the durable run.",
  inputSchema: z.object({ runId: z.string().uuid(), output: testWritingAgentOutputSchema }),
  execute: ({ output, runId }) => {
    const parsed = testWritingAgentOutputSchema.parse(output);
    if (resolveTestWriterFixtureMode().enabled) {
      const receiptSecret = process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET;
      if (!receiptSecret) throw new Error("Test execution receipt secret is not configured.");
      for (const result of parsed.redEvidence.results) {
        const test = parsed.testPlan.tests.find(({ id }) => id === result.testId);
        if (
          !test ||
          !verifyTestExecutionReceipt(
            {
              command: result.command,
              exitCode: result.exitCode,
              expectedAssertions: [result.expectedAssertion],
              outcome: result.outcome,
              outputSha256: result.outputReference.sha256,
              patchSha256: parsed.testPlan.patch.sha256,
              testPaths: [test.path],
            },
            result.executionReceipt,
            receiptSecret,
          )
        ) {
          throw new Error(`Invalid execution receipt for ${result.testId}.`);
        }
      }
      return {
        persistedArtifactTypes: ["validation_report", "test_plan"],
        runId,
        stage: "test-writing" as const,
        status: "advanced" as const,
        stepId: "00000000-0000-4000-8000-000000000347",
        testCount: parsed.testPlan.tests.length,
      };
    }
    return applyDevelopmentLoopTestWritingResult({ database: db, output: parsed, runId });
  },
});
