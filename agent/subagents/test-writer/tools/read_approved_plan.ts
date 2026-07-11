import { and, eq } from "drizzle-orm";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { db } from "@/db/client";
import { agentPlans, approvals } from "@/db/schema";

import {
  computePlanningArtifactDigest,
  createPlanningAgentSeedPlan,
  planningAgentOutputSchema,
} from "../../../planning-agent";
import { resolveTestWriterFixtureMode } from "../lib/fixture-mode";

const inputSchema = z.object({
  runId: z.string().uuid(),
});

export default defineTool({
  description: "Validate an exact approved plan and prepare its commit-pinned sandbox checkout.",
  inputSchema,
  async execute(input, ctx) {
    const fixtureMode = resolveTestWriterFixtureMode();
    const fixturePlan = fixtureMode.enabled
      ? createPlanningAgentSeedPlan({
          body: [
            "## Acceptance Criteria",
            "- Red evidence is tied to the plan acceptance criteria.",
            "- The automated test plan and fixture data are reusable downstream.",
            "- Future model, prompt, and tool changes have eval coverage.",
            "- ADR 0015 records the orchestrator, sibling subagents, isolated sandboxes, and artifact handoff.",
          ].join("\n"),
          issueNumber: 47,
          labels: ["area:agents"],
          milestone: null,
          repositoryFullName: "ncolesummers/loopworks",
          repositoryRevision: { commitSha: "a".repeat(40), ref: "main" },
          title: "Test-writing subagent for the development loop",
        })
      : undefined;
    const planRows = fixtureMode.enabled
      ? [{ id: "00000000-0000-4000-8000-000000000147", plan: fixturePlan, status: "approved" }]
      : await db.select().from(agentPlans).where(eq(agentPlans.runId, input.runId));
    const planApprovals = fixtureMode.enabled
      ? [
          {
            metadata: {
              planId: "00000000-0000-4000-8000-000000000147",
              planSha256: fixturePlan?.identity.sha256,
            },
            status: "approved",
          },
        ]
      : await db
          .select()
          .from(approvals)
          .where(and(eq(approvals.runId, input.runId), eq(approvals.scope, "plan-review")));
    if (planRows.length !== 1 || planApprovals.length !== 1) {
      throw new Error("Test writing requires exactly one durable plan and plan review.");
    }
    const planRow = planRows[0];
    const approval = planApprovals[0];
    const plan = planningAgentOutputSchema.parse(planRow?.plan);
    if (!plan.repositoryRevision) throw new Error("Approved plan must pin a repository revision.");
    if (
      planRow?.status !== "approved" ||
      approval?.status !== "approved" ||
      approval.metadata?.planId !== planRow.id ||
      approval.metadata?.planSha256 !== plan.identity.sha256 ||
      computePlanningArtifactDigest(plan) !== plan.identity.sha256
    ) {
      throw new Error("Approval is not bound to the exact planning artifact.");
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(plan.issue.repositoryFullName)) {
      throw new Error("Repository name is not safe for checkout.");
    }

    if (!fixtureMode.enabled) {
      const sandbox = await ctx.getSandbox();
      const repoUrl = `https://github.com/${plan.issue.repositoryFullName}.git`;
      await sandbox.setNetworkPolicy({
        allow: ["github.com", "objects.githubusercontent.com", "registry.npmjs.org"],
      });
      try {
        const command = [
          `git clone --filter=blob:none ${JSON.stringify(repoUrl)} repo`,
          `cd repo`,
          `git checkout --detach ${plan.repositoryRevision.commitSha}`,
          `command -v bun`,
          `bun install --frozen-lockfile --ignore-scripts`,
          `test -z "$(git status --porcelain)"`,
        ].join(" && ");
        const result = await sandbox.run({ command, abortSignal: AbortSignal.timeout(120_000) });
        if (result.exitCode !== 0) throw new Error("Commit-pinned repository checkout failed.");
        await sandbox.run({
          command: "mkdir -p .loopworks",
          abortSignal: AbortSignal.timeout(5_000),
        });
        await sandbox.writeTextFile({
          path: ".loopworks/repository-commit",
          content: plan.repositoryRevision.commitSha,
        });
      } finally {
        await sandbox.setNetworkPolicy("deny-all");
      }
    }

    return {
      fixtureMode: fixtureMode.enabled,
      planId: plan.identity.id,
      planRowId: planRow.id,
      planSha256: plan.identity.sha256,
      repositoryFullName: plan.issue.repositoryFullName,
      repositoryRevision: plan.repositoryRevision,
      runId: input.runId,
    };
  },
});
