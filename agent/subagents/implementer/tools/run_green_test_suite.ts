import { SpanStatusCode } from "@opentelemetry/api";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { startLoopworksSpan } from "@/lib/observability/trace-context";
import { computeTestPlanDigest } from "../../../test-writing-agent";
import { loadImplementationHandoff } from "../lib/context";
import { resolveImplementerFixtureMode } from "../lib/fixture-mode";
import {
  assertExactFocusedCommand,
  classifyGreenRun,
  createImplementationExecutionReceipt,
  redactImplementationOutput,
  sha256,
} from "../lib/tool-policy";

const digest = z.string().regex(/^[a-f0-9]{64}$/);

export default defineTool({
  description: "Run one exact planned test and return signed, redacted green evidence.",
  inputSchema: z.object({
    runId: z.string().uuid(),
    testId: z.string().min(1),
    command: z.string().min(1),
    planSha256: digest,
    testPlanSha256: digest,
    testPatchSha256: digest,
    productionPatchSha256: digest,
  }),
  async execute(input, ctx) {
    const handoff = await loadImplementationHandoff(input.runId);
    const plannedTest = handoff.testPlan.tests.find(({ id }) => id === input.testId);
    if (!plannedTest) throw new Error("Focused test is not present in the durable test plan.");
    if (
      input.planSha256 !== handoff.plan.identity.sha256 ||
      input.testPlanSha256 !== computeTestPlanDigest(handoff.testPlan) ||
      input.testPatchSha256 !== handoff.testPlan.patch.sha256
    ) {
      throw new Error("Focused test digests do not match the durable handoff.");
    }
    assertExactFocusedCommand(input.command, plannedTest.command, plannedTest.path);
    const sandbox = await ctx.getSandbox();
    const marker = await sandbox.readTextFile({ path: ".loopworks/production-patch.json" });
    const markerSha = marker ? (JSON.parse(marker) as { sha256?: string }).sha256 : undefined;
    if (markerSha !== input.productionPatchSha256) {
      throw new Error("Focused test is not bound to the current production patch.");
    }
    const span = startLoopworksSpan("loopworks.implementation.test.green", {
      attributes: { "loopworks.agent": "implementer", "loopworks.stage": "development" },
    });
    const startedAt = Date.now();
    try {
      const result = resolveImplementerFixtureMode().enabled
        ? { exitCode: 0, stdout: `PASS ${plannedTest.path}`, stderr: "" }
        : await sandbox.run({
            command: `cd repo && ${input.command}`,
            abortSignal: AbortSignal.timeout(120_000),
          });
      const redacted = redactImplementationOutput(`${result.stdout}\n${result.stderr}`);
      const outcome = classifyGreenRun({
        exitCode: result.exitCode,
        output: redacted,
        testPath: plannedTest.path,
      });
      if (outcome !== "pass") throw new Error("Focused implementation test did not pass safely.");
      const outputSha256 = sha256(redacted);
      const uri = `.loopworks/green-evidence/${outputSha256}.log`;
      await sandbox.run({ command: "mkdir -p .loopworks/green-evidence" });
      await sandbox.writeTextFile({ path: uri, content: redacted });
      const executionReceipt = createImplementationExecutionReceipt(
        {
          kind: "focused",
          command: input.command,
          exitCode: result.exitCode,
          outcome,
          outputSha256,
          planSha256: input.planSha256,
          testPlanSha256: input.testPlanSha256,
          testPatchSha256: input.testPatchSha256,
          productionPatchSha256: input.productionPatchSha256,
          testPaths: [plannedTest.path],
        },
        process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET ?? "",
      );
      span.setStatus({ code: SpanStatusCode.OK });
      return {
        durationMs: Math.max(0, Date.now() - startedAt),
        executionReceipt,
        exitCode: 0 as const,
        outcome: "pass" as const,
        outputReference: {
          uri: `artifact://sandbox/${sandbox.id}/${uri}`,
          sha256: outputSha256,
          byteCount: Buffer.byteLength(redacted),
          redacted: true as const,
        },
      };
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  },
});
