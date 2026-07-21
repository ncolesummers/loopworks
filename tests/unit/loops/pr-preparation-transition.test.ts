/** @vitest-environment node */

import { and, eq, inArray } from "drizzle-orm";

import { createPrPreparationFixtureContext } from "@agent/pr-preparation-fixture";
import { computePrPreparationDigest } from "@agent/pr-preparation-agent";
import { createPrPreparationResultFromContext } from "@agent/subagents/pr-preparer/lib/context";
import {
  agentPlans,
  approvals,
  artifacts,
  deployments,
  loopRuns,
  repositories,
  runSteps,
} from "@/db/schema";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  applyDevelopmentLoopPrPreparationResult,
  executeDevelopmentLoopPrStage,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import { createScreenshotEvidenceArtifactMetadata } from "@/lib/loops/screenshot-evidence";
import { createValidationReportArtifactMetadata } from "@/lib/loops/validation-report";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

function runDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

function transitionDatabase(context: PgliteTestDatabase): DevelopmentLoopTransitionDatabase {
  return context.db as unknown as DevelopmentLoopTransitionDatabase;
}

describe("PR preparation transition", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    vi.stubEnv("LOOPWORKS_PUBLIC_URL", "https://loopworks.example");
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      defaultBranch: "main",
      enabledLoops: ["Agent-ready development loop"],
      fullName: "ncolesummers/loopworks",
      githubRepoId: 50_000_001,
      installationId: 50_001,
      name: "loopworks",
      owner: "ncolesummers",
      validationGates: ["Aggregate validation"],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await context.close();
  });

  async function prepare() {
    const fixture = createPrPreparationFixtureContext();
    const created = await createDevelopmentLoopRun({
      database: runDatabase(context),
      now: () => new Date("2026-07-20T20:00:00.000Z"),
      trigger: {
        body: "## Acceptance Criteria\n- Prepare a typed PR intent from exact durable evidence.",
        deliveryId: "issue-50-pr-preparation",
        issueNumber: 50,
        issueUrl: "https://github.com/ncolesummers/loopworks/issues/50",
        labels: ["area:agents", "loop:development"],
        milestone: "M4 Validation + PR Path + MVP Security Review",
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "1".repeat(40) },
        title: "PR preparation subagent for PR intent content",
      },
    });
    if (created.mode !== "created") throw new Error("Expected a persisted run.");
    const runId = created.runId;
    const [planRow] = await context.db.select().from(agentPlans).where(eq(agentPlans.runId, runId));
    if (!planRow) throw new Error("Expected a plan row.");
    await context.db
      .update(agentPlans)
      .set({ status: "approved" })
      .where(eq(agentPlans.id, planRow.id));
    await context.db
      .update(approvals)
      .set({ status: "approved", resolvedBy: "maintainer", resolvedAt: new Date() })
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "plan-review")));
    await context.db
      .update(runSteps)
      .set({ status: "succeeded", completedAt: new Date("2026-07-20T20:05:00.000Z") })
      .where(
        and(
          eq(runSteps.runId, runId),
          inArray(runSteps.stage, ["validation", "code-review", "commit"]),
        ),
      );
    await context.db
      .update(loopRuns)
      .set({ currentStage: "pr", status: "running" })
      .where(eq(loopRuns.id, runId));

    const steps = await context.db.select().from(runSteps).where(eq(runSteps.runId, runId));
    const requiredStep = (stage: string) => {
      const step = steps.find((candidate) => candidate.stage === stage);
      if (!step) throw new Error(`Expected ${stage} step.`);
      return step;
    };
    const validationStep = requiredStep("validation");
    const reviewStep = requiredStep("code-review");
    const commitStep = requiredStep("commit");
    const prStep = requiredStep("pr");
    fixture.validationReviewResult.binding.runId = runId;
    const validationSha = computePrPreparationDigest(fixture.validationReport);
    const reviewSha = computePrPreparationDigest(fixture.validationReviewResult);
    const screenshotSha = computePrPreparationDigest(fixture.screenshotEvidence);
    await context.db
      .update(artifacts)
      .set({
        metadata: createValidationReportArtifactMetadata(fixture.validationReport),
        sha256: validationSha,
      })
      .where(and(eq(artifacts.stepId, validationStep.id), eq(artifacts.type, "validation_report")));
    await context.db
      .update(artifacts)
      .set({
        metadata: createScreenshotEvidenceArtifactMetadata(fixture.screenshotEvidence),
        sha256: screenshotSha,
      })
      .where(and(eq(artifacts.stepId, validationStep.id), eq(artifacts.type, "screenshot")));
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          validationReviewMetadataKind: "validation_review_result",
          validationReviewResult: fixture.validationReviewResult,
          validationReviewResultSchemaId: fixture.validationReviewResult.schemaId,
          validationReviewVersion: 1,
        },
        sha256: reviewSha,
      })
      .where(and(eq(artifacts.stepId, reviewStep.id), eq(artifacts.type, "log_summary")));
    const deployment = fixture.deployment;
    if (!deployment) throw new Error("Expected fixture deployment.");
    const [repository] = await context.db.select({ id: repositories.id }).from(repositories);
    if (!repository) throw new Error("Expected fixture repository.");
    await context.db.insert(deployments).values({
      branch: deployment.branch,
      commitSha: deployment.commitSha,
      createdAt: new Date("2026-07-20T20:06:00.000Z"),
      environment: deployment.environment,
      externalId: `deployment-${runId}`,
      projectName: "loopworks",
      provider: "vercel",
      repositoryId: repository.id,
      runId,
      status: "ready",
      url: deployment.url,
    });

    const artifactRows = await context.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.runId, runId));
    const succeededIds = new Set([validationStep.id, reviewStep.id, commitStep.id]);
    const completedArtifacts = artifactRows
      .flatMap((row) =>
        row.stepId && succeededIds.has(row.stepId) && typeof row.sha256 === "string"
          ? [{ title: row.title, type: row.type, uri: row.uri, sha256: row.sha256 }]
          : [],
      )
      .sort((left, right) =>
        `${left.type}\u0000${left.title}\u0000${left.uri}`.localeCompare(
          `${right.type}\u0000${right.title}\u0000${right.uri}`,
        ),
      );
    const runUrl = `https://loopworks.example/runs?run=${runId}`;
    await context.db.insert(approvals).values({
      metadata: { prChangeDigest: "sha256:prepared-change" },
      requestedBy: "loopworks",
      runId,
      scope: "external-write-review",
      status: "requested",
    });
    const preparedContext = {
      ...fixture,
      run: { ...fixture.run, id: runId, runUrl },
      planId: planRow.id,
      approvalPlanId: planRow.id,
      plan: planRow.plan as typeof fixture.plan,
      validationStep: { id: validationStep.id, status: validationStep.status },
      reviewStep: { id: reviewStep.id, status: reviewStep.status },
      commitStep: { id: commitStep.id, status: commitStep.status },
      prStep: { id: prStep.id, status: prStep.status, attempt: prStep.attempt },
      completedArtifacts,
      validationArtifactSha256: validationSha,
      validationArtifactUri:
        completedArtifacts.find((artifact) => artifact.sha256 === validationSha)?.uri ?? "",
      reviewArtifactSha256: reviewSha,
      screenshotArtifactSha256: screenshotSha,
      artifactSetSha256: computePrPreparationDigest(completedArtifacts),
    };
    const output = createPrPreparationResultFromContext(preparedContext, {
      title: "Issue #50: PR preparation subagent",
      summary: "Prepare typed PR intent without granting GitHub mutation authority.",
    });
    return { output, preparedContext, runId, runUrl };
  }

  it("persists the exact intent, replays idempotently, and rejects conflicting replay", async () => {
    const { output, runId, runUrl } = await prepare();

    const first = await applyDevelopmentLoopPrPreparationResult({
      database: transitionDatabase(context),
      output,
      runId,
      runUrl,
    });
    const replay = await applyDevelopmentLoopPrPreparationResult({
      database: transitionDatabase(context),
      output,
      runId,
      runUrl,
    });
    expect(first).toMatchObject({ stage: "pr", status: "prepared" });
    expect(replay).toMatchObject({ idempotent: true, status: "prepared" });

    const [artifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));
    expect(artifact?.metadata).toMatchObject({
      prIntent: output.intent,
      prPreparationResult: output,
      prPreparationResultSchemaId: "loopworks.pr_preparation_result.v1",
    });
    const [externalApproval] = await context.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "external-write-review")));
    expect(externalApproval?.metadata).toMatchObject({
      prChangeDigest: "sha256:prepared-change",
      prIntentDigest: computePrPreparationDigest(output),
    });

    if (!externalApproval) throw new Error("Expected external-write approval.");
    await applyApprovalTransition({
      action: "approve",
      actorId: "maintainer",
      approvalId: externalApproval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });
    const [approved] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.id, externalApproval.id));
    expect(approved?.metadata).toMatchObject({
      prChangeDigest: "sha256:prepared-change",
      prIntentDigest: computePrPreparationDigest(output),
    });

    await expect(
      applyDevelopmentLoopPrPreparationResult({
        database: transitionDatabase(context),
        output: {
          ...output,
          intent: { ...output.intent, title: "Conflicting title" },
        },
        runId,
        runUrl,
      }),
    ).rejects.toThrow("conflicting");

    await expect(
      executeDevelopmentLoopPrStage({
        database: transitionDatabase(context),
        mode: "development",
        runId,
        runUrl,
      }),
    ).resolves.toMatchObject({ status: "advanced" });
  });

  it("atomically accepts only one of two concurrent conflicting preparations", async () => {
    const { output, preparedContext, runId, runUrl } = await prepare();
    const conflicting = createPrPreparationResultFromContext(preparedContext, {
      title: "Issue #50: competing PR preparation",
      summary: "A different bounded narrative must not overwrite the winner.",
    });

    const results = await Promise.allSettled([
      applyDevelopmentLoopPrPreparationResult({
        database: transitionDatabase(context),
        output,
        runId,
        runUrl,
      }),
      applyDevelopmentLoopPrPreparationResult({
        database: transitionDatabase(context),
        output: conflicting,
        runId,
        runUrl,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [artifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));
    expect(artifact?.sha256).toBe(
      computePrPreparationDigest(results[0]?.status === "fulfilled" ? output : conflicting),
    );
  });

  it("rejects a caller-supplied run URL outside the configured Loopworks origin", async () => {
    const { output, runId } = await prepare();

    await expect(
      applyDevelopmentLoopPrPreparationResult({
        database: transitionDatabase(context),
        output,
        runId,
        runUrl: `https://attacker.example/runs?run=${runId}`,
      }),
    ).rejects.toThrow("canonical Loopworks run URL");
  });
});
