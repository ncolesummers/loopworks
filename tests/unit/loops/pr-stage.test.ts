/** @vitest-environment node */
import { and, eq, inArray } from "drizzle-orm";

import {
  computePrPreparationDigest,
  prPreparationAgentModelLabel,
  prPreparationResultSchema,
  prPreparationResultSchemaId,
} from "@agent/pr-preparation-agent";

import { approvals, artifacts, deployments, loopRuns, repositories, runSteps } from "@/db/schema";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  applyDevelopmentLoopValidationReport,
  executeDevelopmentLoopPrStage,
  type DevelopmentLoopTransitionDatabase,
  retryDevelopmentLoopStep,
} from "@/lib/loops/development-run-transitions";
import {
  composePrIntent,
  createPrIntentArtifactMetadata,
  prIntentArtifactMetadataSchema,
  prIntentSchemaId,
  prIntentV1Schema,
} from "@/lib/loops/pr-intent";
import {
  type ValidationReportV1,
  validationReportSchemaId,
  validationReportV1Schema,
} from "@/lib/loops/validation-report";
import {
  createPullRequestChangeDigest,
  type GitHubPullRequestWriter,
} from "@/lib/github/pull-request";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

function runUrlFor(runId: string): string {
  return `https://loopworks.example/runs?run=${runId}`;
}
const liveChanges = [{ content: "export const ready = true;\n", path: "src/ready.ts" }];
const liveCommitMessage = "feat: prepare guarded PR";
const liveChangeDigest = createPullRequestChangeDigest({
  changes: liveChanges,
  commitMessage: liveCommitMessage,
});

function testRunDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

function transitionDatabase(context: PgliteTestDatabase): DevelopmentLoopTransitionDatabase {
  return context.db as unknown as DevelopmentLoopTransitionDatabase;
}

function passingValidationReport(): ValidationReportV1 {
  return validationReportV1Schema.parse({
    counts: { failed: 0, passed: 1, skipped: 0, total: 1 },
    generatedAt: "2026-07-09T20:05:00.000Z",
    overallOutcome: "pass",
    results: [
      {
        command: "bun run validate",
        durationMs: 5_000,
        exitCode: 0,
        key: "aggregate-validation",
        name: "Aggregate validation",
        outcome: "pass",
        phase: "before_rollout",
        produces: "validation_report",
        required: true,
      },
    ],
    schemaId: validationReportSchemaId,
    version: 1,
  });
}

function failingValidationReport(): ValidationReportV1 {
  return validationReportV1Schema.parse({
    counts: { failed: 1, passed: 0, skipped: 0, total: 1 },
    generatedAt: "2026-07-09T20:05:00.000Z",
    overallOutcome: "fail",
    results: [
      {
        command: "bun run validate",
        durationMs: 5_000,
        exitCode: 1,
        key: "aggregate-validation",
        name: "Aggregate validation",
        outcome: "fail",
        phase: "before_rollout",
        produces: "validation_report",
        required: true,
      },
    ],
    schemaId: validationReportSchemaId,
    version: 1,
  });
}

function unrelatedPassingValidationReport(): ValidationReportV1 {
  return validationReportV1Schema.parse({
    counts: { failed: 0, passed: 1, skipped: 0, total: 1 },
    generatedAt: "2026-07-09T20:05:00.000Z",
    overallOutcome: "pass",
    results: [
      {
        command: "bun run format:check",
        durationMs: 500,
        exitCode: 0,
        key: "format-check",
        name: "Format check",
        outcome: "pass",
        phase: "before_rollout",
        produces: "validation_report",
        required: true,
      },
    ],
    schemaId: validationReportSchemaId,
    version: 1,
  });
}

function createMetrics() {
  return {
    stepDuration: vi.fn(),
    stepRetry: vi.fn(),
  };
}

describe("development-loop PR stage", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    vi.stubEnv("LOOPWORKS_PUBLIC_URL", "https://loopworks.example");
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      defaultBranch: "main",
      enabledLoops: ["Agent-ready development loop"],
      fullName: "ncolesummers/loopworks",
      githubRepoId: 15_000_001,
      installationId: 15_001,
      name: "loopworks",
      owner: "ncolesummers",
      validationGates: ["Aggregate validation"],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await context.close();
  });

  async function createRun(report: ValidationReportV1 = passingValidationReport()) {
    const created = await createDevelopmentLoopRun({
      database: testRunDatabase(context),
      now: () => new Date("2026-07-09T20:00:00.000Z"),
      trigger: {
        body: "## Acceptance Criteria\n- PR creation is guarded.",
        deliveryId: "issue-15-delivery",
        issueNumber: 15,
        issueUrl: "https://github.com/ncolesummers/loopworks/issues/15",
        labels: ["area:github", "area:loops", "priority:p1"],
        milestone: "M4 Validation + PR Path + MVP Security Review",
        repositoryFullName: "ncolesummers/loopworks",
        title: "PR creation path",
      },
    });
    if (created.mode !== "created") {
      throw new Error("Expected a persisted development-loop run.");
    }

    await applyDevelopmentLoopValidationReport({
      database: transitionDatabase(context),
      occurredAt: new Date("2026-07-09T20:05:00.000Z"),
      report,
      runId: created.runId,
    });
    return created.runId;
  }

  async function preparePrStage(input?: {
    approvalStatus?: "approved" | "requested";
    report?: ValidationReportV1;
  }) {
    const runId = await createRun(input?.report);
    await context.db
      .update(runSteps)
      .set({
        completedAt: new Date("2026-07-09T20:08:00.000Z"),
        startedAt: new Date("2026-07-09T20:06:00.000Z"),
        status: "succeeded",
      })
      .where(and(eq(runSteps.runId, runId), inArray(runSteps.stage, ["code-review", "commit"])));
    await context.db
      .update(loopRuns)
      .set({ currentStage: "pr", status: "running" })
      .where(eq(loopRuns.id, runId));

    if (input?.approvalStatus) {
      await context.db.insert(approvals).values({
        id: "15000000-0000-4000-8000-000000000003",
        note: "Validated external write scope.",
        metadata: { prChangeDigest: liveChangeDigest },
        requestedBy: "loopworks",
        resolvedAt:
          input.approvalStatus === "approved" ? new Date("2026-07-09T20:09:00.000Z") : null,
        resolvedBy: input.approvalStatus === "approved" ? "ncolesummers" : null,
        runId,
        scope: "external-write-review",
        status: input.approvalStatus,
      });
    }

    await context.db.insert(deployments).values({
      branch: "codex/15-pea-arr",
      commitSha: "abc123",
      createdAt: new Date("2026-07-09T20:09:00.000Z"),
      environment: "preview",
      externalId: `deployment-${runId}`,
      projectName: "loopworks",
      provider: "vercel",
      repositoryId: (
        await context.db.select({ id: repositories.id }).from(repositories).limit(1)
      )[0]?.id,
      runId,
      status: "ready",
      url: "https://loopworks-pr-15.vercel.app",
    });

    const [prStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "pr")));
    const [validationArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "validation_report")));
    const [prArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));
    if (!prStep || !validationArtifact || !prArtifact) {
      throw new Error("Expected PR-stage fixture rows.");
    }
    const report = input?.report ?? passingValidationReport();
    const intent = composePrIntent({
      artifacts: [
        {
          title: validationArtifact.title,
          type: validationArtifact.type,
          uri: validationArtifact.uri,
        },
      ],
      deployment: {
        branch: "codex/15-pea-arr",
        commitSha: "abc123",
        environment: "preview",
        status: "ready",
        url: "https://loopworks-pr-15.vercel.app",
      },
      issue: {
        number: 15,
        title: "PR creation path",
        url: "https://github.com/ncolesummers/loopworks/issues/15",
      },
      run: { id: runId, url: runUrlFor(runId) },
      validation: { artifactUri: validationArtifact.uri, report },
    });
    const preparation = prPreparationResultSchema.parse({
      version: 1,
      schemaId: prPreparationResultSchemaId,
      model: prPreparationAgentModelLabel,
      narrative: { title: intent.title, summary: "Prepare the guarded PR intent." },
      binding: {
        runId,
        prAttempt: prStep.attempt,
        planId: "fixture-plan",
        planSha256: "1".repeat(64),
        validationReportSha256: computePrPreparationDigest(report),
        validationReviewResultSha256: "2".repeat(64),
        screenshotEvidenceSha256: "3".repeat(64),
        artifactSetSha256: "4".repeat(64),
        deploymentContextSha256: "5".repeat(64),
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "6".repeat(40),
      },
      intent,
      screenshots: [],
    });
    const preparationDigest = computePrPreparationDigest(preparation);
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          ...createPrIntentArtifactMetadata(intent),
          prPreparationResult: preparation,
          prPreparationResultSchemaId,
          prPreparationResultSha256: preparationDigest,
        },
        sha256: preparationDigest,
      })
      .where(eq(artifacts.id, prArtifact.id));
    if (input?.approvalStatus) {
      await context.db
        .update(approvals)
        .set({ metadata: { prChangeDigest: liveChangeDigest, prIntentDigest: preparationDigest } })
        .where(and(eq(approvals.runId, runId), eq(approvals.scope, "external-write-review")));
    }

    return runId;
  }

  it("persists a dev-mode PR intent without invoking GitHub", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const metrics = createMetrics();

    const result = await executeDevelopmentLoopPrStage({
      database: transitionDatabase(context),
      metrics,
      mode: "development",
      occurredAt: new Date("2026-07-09T20:10:00.000Z"),
      runId,
      runUrl: runUrlFor(runId),
    });

    expect(result).toMatchObject({
      mode: "development",
      runId,
      status: "advanced",
    });
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    const [step] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "pr")));
    const [artifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));
    const [approval] = await context.db.select().from(approvals).where(eq(approvals.runId, runId));

    expect(run).toMatchObject({ currentStage: "done", status: "running" });
    expect(step).toMatchObject({ status: "succeeded" });
    expect(approval).toMatchObject({ status: "applied" });
    expect(artifact.metadata).toMatchObject({
      prIntentMetadataKind: "pr_intent_result",
      prIntentSchemaId,
      prIntentVersion: 1,
    });
    const parsedIntent = prIntentV1Schema.parse(
      (artifact.metadata as { prIntent: unknown }).prIntent,
    );
    expect(parsedIntent.body).toContain("Validation report: 1 passed, 0 failed, 0 skipped.");
    expect(parsedIntent.body).toContain("https://loopworks-pr-15.vercel.app");
    expect(parsedIntent.body).toContain(runUrlFor(runId));
    expect(metrics.stepDuration).toHaveBeenCalledWith({
      durationSeconds: 0,
      loopKey: "development-loop",
      stage: "pr",
      status: "succeeded",
    });
  });

  it("blocks before GitHub when typed PR preparation is missing", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const writer = vi.fn<GitHubPullRequestWriter>();
    await context.db
      .update(artifacts)
      .set({ metadata: null, sha256: null })
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live",
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "Typed PR preparation is required before PR creation.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it.each([
    { approvalStatus: undefined, expectedRunStatus: "waiting_for_approval" },
    { approvalStatus: "requested" as const, expectedRunStatus: "waiting_for_approval" },
  ])("blocks before GitHub when approval is $approvalStatus", async (testCase) => {
    const runId = await preparePrStage({ approvalStatus: testCase.approvalStatus });
    const writer = vi.fn<GitHubPullRequestWriter>();

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live",
      occurredAt: new Date("2026-07-09T20:10:00.000Z"),
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "External write approval is required before PR creation.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    expect(run.status).toBe(testCase.expectedRunStatus);
  });

  it("returns blocked validation evidence without invoking GitHub", async () => {
    const runId = await createRun(failingValidationReport());
    const writer = vi.fn<GitHubPullRequestWriter>();

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: [{ content: "export const ready = true;\n", path: "src/ready.ts" }],
      commitMessage: "feat: prepare guarded PR",
      database: transitionDatabase(context),
      mode: "live",
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "Deterministic validation did not advance this run.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("fails closed when the repository's required validation gate is absent", async () => {
    const runId = await preparePrStage({
      approvalStatus: "approved",
      report: unrelatedPassingValidationReport(),
    });
    const writer = vi.fn<GitHubPullRequestWriter>();

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live",
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "Deterministic validation did not advance this run.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("blocks live creation when approved evidence does not match the requested bytes", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const writer = vi.fn<GitHubPullRequestWriter>();

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: [{ content: "export const changedAfterApproval = true;\n", path: "src/ready.ts" }],
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live",
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "Approved evidence does not match the requested PR changes.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("blocks live creation when approval does not match the prepared intent", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const writer = vi.fn<GitHubPullRequestWriter>();
    await context.db
      .update(approvals)
      .set({ metadata: { prChangeDigest: liveChangeDigest, prIntentDigest: "0".repeat(64) } })
      .where(and(eq(approvals.runId, runId), eq(approvals.scope, "external-write-review")));

    const result = await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live",
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(result).toMatchObject({
      blockedReason: "Approved evidence does not match the prepared PR intent.",
      status: "blocked",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  it("rejects non-HTTPS live run backlinks before GitHub mutation", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const writer = vi.fn<GitHubPullRequestWriter>();

    await expect(
      executeDevelopmentLoopPrStage({
        actorId: "ncolesummers",
        changes: liveChanges,
        commitMessage: liveCommitMessage,
        database: transitionDatabase(context),
        mode: "live",
        runId,
        runUrl: `http://127.0.0.1:3000/runs?run=${runId}`,
        writer,
      }),
    ).rejects.toThrow("Live PR creation requires an HTTPS Loopworks run URL.");
    expect(writer).not.toHaveBeenCalled();
  });

  it("creates a live draft PR once and replays from persisted state", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const writer = vi.fn<GitHubPullRequestWriter>().mockResolvedValue({
      headBranch: `loopworks/run-${runId}`,
      headSha: "def456",
      number: 115,
      url: "https://github.com/ncolesummers/loopworks/pull/115",
    });

    const input = {
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      mode: "live" as const,
      occurredAt: new Date("2026-07-09T20:10:00.000Z"),
      runId,
      runUrl: runUrlFor(runId),
      writer,
    };
    const first = await executeDevelopmentLoopPrStage(input);
    const replay = await executeDevelopmentLoopPrStage(input);

    expect(first).toMatchObject({
      pullRequestUrl: "https://github.com/ncolesummers/loopworks/pull/115",
      status: "advanced",
    });
    expect(replay).toMatchObject({ idempotent: true, status: "advanced" });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "main",
        body: expect.stringContaining("Validation report: 1 passed, 0 failed, 0 skipped."),
        draft: true,
        installationId: 15_001,
        owner: "ncolesummers",
        repo: "loopworks",
        runId,
        title: "Issue #15: PR creation path",
      }),
    );
    const [artifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, runId), eq(artifacts.type, "pr_intent")));
    expect(artifact.uri).toBe("https://github.com/ncolesummers/loopworks/pull/115");
    expect(artifact.metadata).toMatchObject({
      githubPullRequest: {
        headBranch: `loopworks/run-${runId}`,
        headSha: "def456",
        number: 115,
        url: "https://github.com/ncolesummers/loopworks/pull/115",
      },
    });
    expect(prIntentArtifactMetadataSchema.parse(artifact.metadata)).toBeTruthy();
  });

  it("persists a sanitized failed step that the transition engine can retry", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const metrics = createMetrics();
    const writer = vi
      .fn<GitHubPullRequestWriter>()
      .mockRejectedValueOnce(new Error("Authorization token=super-secret failed"))
      .mockResolvedValueOnce({
        headBranch: `loopworks/run-${runId}`,
        headSha: "def456",
        number: 115,
        url: "https://github.com/ncolesummers/loopworks/pull/115",
      });
    const input = {
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      metrics,
      mode: "live" as const,
      occurredAt: new Date("2026-07-09T20:10:00.000Z"),
      runId,
      runUrl: runUrlFor(runId),
      writer,
    };

    await expect(executeDevelopmentLoopPrStage(input)).rejects.toThrow(
      "PR creation failed; the step is ready for inspection and retry.",
    );
    const [failedStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, runId), eq(runSteps.stage, "pr")));
    expect(failedStep).toMatchObject({ status: "failed" });
    expect(failedStep.metadata).toMatchObject({ failureCode: "github_pr_creation_failed" });
    expect(JSON.stringify(failedStep.metadata)).not.toContain("super-secret");
    expect(metrics.stepDuration).toHaveBeenCalledWith({
      durationSeconds: 0,
      loopKey: "development-loop",
      stage: "pr",
      status: "failed",
    });

    await retryDevelopmentLoopStep({
      database: transitionDatabase(context),
      metrics,
      occurredAt: new Date("2026-07-09T20:11:00.000Z"),
      reason: "github_pr_creation_failed",
      runId,
      stage: "pr",
    });
    await expect(
      executeDevelopmentLoopPrStage({
        ...input,
        occurredAt: new Date("2026-07-09T20:12:00.000Z"),
      }),
    ).resolves.toMatchObject({ status: "advanced" });
    expect(writer).toHaveBeenCalledTimes(2);
    const [recoveredRun] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, runId));
    expect(recoveredRun.metadata).toMatchObject({
      deliveryId: "issue-15-delivery",
      issueTitle: "PR creation path",
      validationReportSchemaId,
    });
    expect(recoveredRun.metadata).not.toMatchObject({
      failureCode: expect.anything(),
      retryable: expect.anything(),
    });
  });

  it("measures the real live-write interval for PR-step telemetry", async () => {
    const runId = await preparePrStage({ approvalStatus: "approved" });
    const metrics = createMetrics();
    const times = [new Date("2026-07-09T20:10:00.000Z"), new Date("2026-07-09T20:10:02.500Z")];
    const writer = vi.fn<GitHubPullRequestWriter>().mockResolvedValue({
      headBranch: `loopworks/run-${runId}`,
      headSha: "def456",
      number: 115,
      url: "https://github.com/ncolesummers/loopworks/pull/115",
    });

    await executeDevelopmentLoopPrStage({
      actorId: "ncolesummers",
      changes: liveChanges,
      commitMessage: liveCommitMessage,
      database: transitionDatabase(context),
      metrics,
      mode: "live",
      now: () => times.shift() ?? new Date("2026-07-09T20:10:02.500Z"),
      runId,
      runUrl: runUrlFor(runId),
      writer,
    });

    expect(metrics.stepDuration).toHaveBeenCalledWith({
      durationSeconds: 2.5,
      loopKey: "development-loop",
      stage: "pr",
      status: "succeeded",
    });
  });
});
