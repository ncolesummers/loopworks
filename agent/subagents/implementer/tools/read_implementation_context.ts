import { SpanStatusCode } from "@opentelemetry/api";
import { defineTool } from "eve/tools";
import { z } from "zod";

import { startLoopworksSpan } from "@/lib/observability/trace-context";
import { computeImplementationDigest } from "../../../implementation-agent";
import { computeTestPlanDigest } from "../../../test-writing-agent";
import { resolveImplementerFixtureMode } from "../lib/fixture-mode";
import { loadImplementationHandoff } from "../lib/context";
import { assertWellFormedRepositoryFullName } from "../lib/tool-policy";

export default defineTool({
  description: "Load and verify the approved plan, exact test patch, red evidence, and fixtures.",
  inputSchema: z.object({ runId: z.string().uuid() }),
  async execute({ runId }, ctx) {
    const handoff = await loadImplementationHandoff(runId);
    const revision = handoff.plan.repositoryRevision;
    if (!revision) throw new Error("Implementation requires a pinned repository revision.");
    const binding = {
      planId: handoff.plan.identity.id,
      planSha256: handoff.plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(handoff.testPlan),
      testPatchSha256: handoff.testPlan.patch.sha256,
      fixturesSha256: computeImplementationDigest(handoff.testPlan.fixtures),
      repositoryFullName: handoff.plan.issue.repositoryFullName,
      commitSha: revision.commitSha,
    };
    const sandbox = await ctx.getSandbox();
    if (!resolveImplementerFixtureMode().enabled) {
      assertWellFormedRepositoryFullName(handoff.plan.issue.repositoryFullName);
      const repoUrl = `https://github.com/${handoff.plan.issue.repositoryFullName}.git`;
      const span = startLoopworksSpan("loopworks.implementation.checkout", {
        attributes: { "loopworks.agent": "implementer", "loopworks.stage": "development" },
      });
      try {
        await sandbox.setNetworkPolicy({
          allow: ["github.com", "objects.githubusercontent.com", "registry.npmjs.org"],
        });
        const result = await sandbox.run({
          command: [
            `git clone --filter=blob:none ${JSON.stringify(repoUrl)} repo`,
            "cd repo",
            `git checkout --detach ${revision.commitSha}`,
            "command -v bun",
            "bun install --frozen-lockfile --ignore-scripts",
            'test -z "$(git status --porcelain)"',
          ].join(" && "),
          abortSignal: AbortSignal.timeout(120_000),
        });
        if (result.exitCode !== 0) throw new Error("Commit-pinned checkout failed.");
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        await sandbox.setNetworkPolicy("deny-all");
        span.end();
      }
    }
    await sandbox.run({ command: "mkdir -p .loopworks" });
    await sandbox.writeTextFile({
      path: ".loopworks/repository-commit",
      content: revision.commitSha,
    });
    await sandbox.writeTextFile({
      path: ".loopworks/implementation-context.json",
      content: JSON.stringify({ binding, runId }),
    });
    return {
      acceptanceCriteria: handoff.testPlan.acceptanceCriteria,
      binding,
      fixtures: handoff.testPlan.fixtures,
      runId,
      tests: handoff.testPlan.tests,
    };
  },
});
