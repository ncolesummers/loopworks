import { SpanStatusCode } from "@opentelemetry/api";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { startLoopworksSpan } from "@/lib/observability/trace-context";
import { resolveTestWriterFixtureMode } from "../lib/fixture-mode";
import {
  assertCommandMatchesPlannedTests,
  classifyTestRun,
  createTestExecutionReceipt,
  redactTestOutput,
  sha256,
} from "../lib/tool-policy";

const inputSchema = z.object({
  command: z.string().min(1),
  tests: z
    .array(z.object({ path: z.string().min(1), type: z.enum(["unit", "integration", "browser"]) }))
    .min(1),
  expectedAssertions: z.array(z.string().min(1)).min(1),
  patchSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export default defineTool({
  description: "Run one exact approved focused test command and persist only redacted evidence.",
  inputSchema,
  async execute(input, ctx) {
    assertCommandMatchesPlannedTests(input.command, input.tests);
    const startedAt = Date.now();
    const span = startLoopworksSpan("loopworks.test_writing.execution", {
      attributes: {
        "loopworks.agent": "test-writer",
        "loopworks.stage": "test-writing",
        "loopworks.test.count": input.tests.length,
      },
    });
    try {
      const sandbox = await ctx.getSandbox();
      const fixtureMode = resolveTestWriterFixtureMode();
      const result = fixtureMode.enabled
        ? {
            exitCode: 1,
            stdout: `${input.tests[0]?.path}\n${input.expectedAssertions.join("\n")}`,
            stderr: "",
          }
        : await sandbox.run({
            command: `cd repo && ${input.command}`,
            abortSignal: AbortSignal.timeout(120_000),
          });
      const redacted = redactTestOutput(`${result.stdout}\n${result.stderr}`);
      const digest = sha256(redacted);
      const uri = `.loopworks/red-evidence/${digest}.log`;
      await sandbox.run({ command: "mkdir -p .loopworks/red-evidence" });
      await sandbox.writeTextFile({ path: uri, content: redacted });
      const testPaths = input.tests.map(({ path }) => path);
      const outcome = classifyTestRun({
        exitCode: result.exitCode,
        expectedAssertions: input.expectedAssertions,
        output: redacted,
        testPaths,
      });
      const receiptSecret = process.env.LOOPWORKS_EVE_TEST_RECEIPT_SECRET;
      if (!receiptSecret) throw new Error("Test execution receipt secret is not configured.");
      const executionReceipt = createTestExecutionReceipt(
        {
          command: input.command,
          exitCode: result.exitCode,
          expectedAssertions: input.expectedAssertions,
          outcome,
          outputSha256: digest,
          patchSha256: input.patchSha256,
          testPaths,
        },
        receiptSecret,
      );
      const durationMs = Math.max(0, Date.now() - startedAt);
      span.setAttributes({
        "loopworks.duration_ms": durationMs,
        "loopworks.outcome": outcome,
      });
      span.setStatus({
        code: outcome === "expected_failure" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      return {
        durationMs,
        exitCode: result.exitCode,
        outcome,
        executionReceipt,
        outputReference: {
          uri: `artifact://sandbox/${sandbox.id}/${uri}`,
          sha256: digest,
          byteCount: Buffer.byteLength(redacted),
          redacted: true,
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
