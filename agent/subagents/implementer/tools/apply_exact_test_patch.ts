import { SpanStatusCode } from "@opentelemetry/api";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { startLoopworksSpan } from "@/lib/observability/trace-context";
import { computeTestPlanDigest } from "../../../test-writing-agent";
import { loadImplementationHandoff } from "../lib/context";
import { resolveImplementerFixtureMode } from "../lib/fixture-mode";

export default defineTool({
  description: "Apply only the exact persisted, digest-bound test patch to the pinned checkout.",
  inputSchema: z.object({
    runId: z.string().uuid(),
    testPlanSha256: z.string().regex(/^[a-f0-9]{64}$/),
    testPatchSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  async execute(input, ctx) {
    const span = startLoopworksSpan("loopworks.implementation.test_patch.apply", {
      attributes: { "loopworks.agent": "implementer", "loopworks.stage": "development" },
    });
    try {
      const handoff = await loadImplementationHandoff(input.runId);
      if (
        computeTestPlanDigest(handoff.testPlan) !== input.testPlanSha256 ||
        handoff.testPlan.patch.sha256 !== input.testPatchSha256
      ) {
        throw new Error("Requested test patch does not match the durable handoff.");
      }
      const sandbox = await ctx.getSandbox();
      await sandbox.writeTextFile({
        path: ".loopworks/exact-test.patch",
        content: handoff.testPlan.patch.content,
      });
      if (!resolveImplementerFixtureMode().enabled) {
        const applied = await sandbox.run({
          command:
            "cd repo && git apply --check ../.loopworks/exact-test.patch && git apply ../.loopworks/exact-test.patch",
          abortSignal: AbortSignal.timeout(15_000),
        });
        if (applied.exitCode !== 0) throw new Error("Exact test patch could not be applied.");
        const changed = await sandbox.run({
          command: "cd repo && git diff --name-only",
          abortSignal: AbortSignal.timeout(5_000),
        });
        const paths = changed.stdout.split(/\r?\n/).filter(Boolean).sort();
        const expected = [...handoff.testPlan.patch.paths].sort();
        if (JSON.stringify(paths) !== JSON.stringify(expected)) {
          throw new Error("Applied test patch changed undeclared paths.");
        }
      }
      await sandbox.writeTextFile({
        path: ".loopworks/test-patch-applied",
        content: JSON.stringify({
          paths: handoff.testPlan.patch.paths,
          sha256: input.testPatchSha256,
        }),
      });
      span.setStatus({ code: SpanStatusCode.OK });
      return { applied: true, paths: handoff.testPlan.patch.paths, sha256: input.testPatchSha256 };
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  },
});
