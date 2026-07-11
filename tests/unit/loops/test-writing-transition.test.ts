/** @vitest-environment node */
import { createHash } from "node:crypto";
import { createTestExecutionReceipt } from "@agent/subagents/test-writer/lib/tool-policy";
import {
  redTestEvidenceSchemaId,
  type TestWritingAgentOutput,
  testPlanSchemaId,
  testWriterModelLabel,
} from "@agent/test-writing-agent";
import { and, eq } from "drizzle-orm";
import { approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  applyDevelopmentLoopTestWritingResult,
  type DevelopmentLoopTransitionDatabase,
  DevelopmentLoopTransitionError,
} from "@/lib/loops/development-run-transitions";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function outputForPlan(plan: { id: string; sha256: string }): TestWritingAgentOutput {
  const patch = [
    "diff --git a/tests/unit/red.test.ts b/tests/unit/red.test.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/tests/unit/red.test.ts",
    "@@ -0,0 +1 @@",
    "+expect(false).toBe(true);",
  ].join("\n");
  const testPlan = {
    version: 1 as const,
    schemaId: testPlanSchemaId as typeof testPlanSchemaId,
    plan: {
      id: plan.id,
      sha256: plan.sha256,
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
    },
    acceptanceCriteria: [{ id: "ac-1", text: "Expected red evidence is required." }],
    tests: [
      {
        id: "test-ac-1",
        acceptanceCriterionIds: ["ac-1"],
        type: "unit" as const,
        path: "tests/unit/red.test.ts",
        command: "bun run test -- tests/unit/red.test.ts",
        steps: ["Run focused test."],
        expectedFailure: { kind: "assertion" as const, message: "expected false to be true" },
        fixtureIds: [],
      },
    ],
    fixtures: [],
    patch: {
      format: "unified-diff" as const,
      content: patch,
      sha256: sha256(patch),
      byteCount: Buffer.byteLength(patch),
      paths: ["tests/unit/red.test.ts"],
    },
  };
  const outputSha256 = sha256("redacted");
  const executionReceipt = createTestExecutionReceipt(
    {
      command: "bun run test -- tests/unit/red.test.ts",
      exitCode: 1,
      expectedAssertions: ["expected false to be true"],
      outcome: "expected_failure",
      outputSha256,
      patchSha256: testPlan.patch.sha256,
      testPaths: ["tests/unit/red.test.ts"],
    },
    "test-secret",
  );
  return {
    model: testWriterModelLabel,
    testPlan,
    redEvidence: {
      version: 1,
      schemaId: redTestEvidenceSchemaId,
      planId: plan.id,
      planSha256: plan.sha256,
      testPlanSha256: sha256(JSON.stringify(testPlan)),
      results: [
        {
          id: "red-ac-1",
          testId: "test-ac-1",
          acceptanceCriterionIds: ["ac-1"],
          command: "bun run test -- tests/unit/red.test.ts",
          outcome: "expected_failure",
          exitCode: 1,
          durationMs: 12,
          expectedAssertion: "expected false to be true",
          executionReceipt,
          outputReference: {
            uri: "artifact://redacted/red-ac-1.log",
            sha256: outputSha256,
            byteCount: 8,
            redacted: true,
          },
        },
      ],
    },
  };
}

describe("test-writing stage transition", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      githubRepoId: 47_000_002,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
      enabledLoops: ["Agent-ready development loop"],
      validationGates: ["Focused tests"],
    });
  });

  afterEach(async () => context.close());

  async function prepareRun(
    approvalAction: "approve" | "bypass" | "expire" | "reject" | null = "approve",
  ) {
    const created = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        body: "## Acceptance Criteria\n- Expected red evidence is required.",
        issueNumber: 47,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Test-writing subagent",
      },
    });
    if (created.mode !== "created") throw new Error("Expected created run.");

    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, created.runId));
    if (!approval) throw new Error("Expected plan approval.");
    if (approvalAction) {
      await applyApprovalTransition({
        action: approvalAction,
        actorId: "maintainer",
        approvalId: approval.id,
        database: context.db as unknown as ApprovalTransitionDatabase,
        expectedStatus: "requested",
      });
    }

    const [planRow] = await context.db.query.agentPlans.findMany({
      where: (plan, { eq: equals }) => equals(plan.runId, created.runId),
      limit: 1,
    });
    const plan = planRow?.plan as { identity?: { id?: string; sha256?: string } } | null;
    if (!plan?.identity?.id || !plan.identity.sha256) throw new Error("Expected plan identity.");

    await context.db
      .update(loopRuns)
      .set({ currentStage: "test-writing", status: "running" })
      .where(eq(loopRuns.id, created.runId));
    await context.db
      .update(runSteps)
      .set({ status: "running", startedAt: new Date("2026-07-11T16:00:00.000Z") })
      .where(and(eq(runSteps.runId, created.runId), eq(runSteps.stage, "test-writing")));

    return {
      approval,
      plan: { id: plan.identity.id, sha256: plan.identity.sha256 },
      runId: created.runId,
    };
  }

  it("persists both artifacts and advances expected red to development", async () => {
    const prepared = await prepareRun();
    const result = await applyDevelopmentLoopTestWritingResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      occurredAt: new Date("2026-07-11T16:01:00.000Z"),
      output: outputForPlan(prepared.plan),
      receiptSecret: "test-secret",
      runId: prepared.runId,
    });

    expect(result).toMatchObject({ status: "advanced", stage: "test-writing" });
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, prepared.runId));
    const [step] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "test-writing")));
    if (!step) throw new Error("Expected test-writing step.");
    const artifactRows = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, prepared.runId), eq(artifacts.stepId, step.id)));

    expect(run).toMatchObject({ currentStage: "development", status: "running" });
    expect(step).toMatchObject({ status: "succeeded", validationStatus: "red" });
    expect(artifactRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "validation_report",
          metadata: expect.objectContaining({ redTestEvidenceSchemaId }),
        }),
        expect.objectContaining({
          type: "test_plan",
          metadata: expect.objectContaining({ testPlanSchemaId }),
        }),
      ]),
    );
    expect(artifactRows.find((artifact) => artifact.type === "validation_report")?.sha256).toBe(
      sha256(JSON.stringify(outputForPlan(prepared.plan).redEvidence)),
    );
    expect(artifactRows.find((artifact) => artifact.type === "test_plan")?.sha256).toBe(
      sha256(JSON.stringify(outputForPlan(prepared.plan).testPlan)),
    );
    expect(new Set(artifactRows.map((artifact) => artifact.sha256)).size).toBe(2);
  });

  it.each([
    ["requested", null],
    ["bypassed", "bypass" as const],
    ["rejected", "reject" as const],
    ["expired", "expire" as const],
  ])("fails closed for a %s plan review", async (_status, action) => {
    const prepared = await prepareRun(action);
    await expect(
      applyDevelopmentLoopTestWritingResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: outputForPlan(prepared.plan),
        receiptSecret: "test-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow(DevelopmentLoopTransitionError);
  });

  it("rejects a stale approval digest", async () => {
    const prepared = await prepareRun();
    await context.db
      .update(approvals)
      .set({ metadata: { planId: prepared.plan.id, planSha256: "b".repeat(64) } })
      .where(eq(approvals.id, prepared.approval.id));

    await expect(
      applyDevelopmentLoopTestWritingResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: outputForPlan(prepared.plan),
        receiptSecret: "test-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow(DevelopmentLoopTransitionError);
  });

  it("rejects self-attested evidence without a valid execution receipt", async () => {
    const prepared = await prepareRun();
    const output = outputForPlan(prepared.plan);
    const result = output.redEvidence.results[0];
    if (!result) throw new Error("Expected red evidence fixture.");
    result.executionReceipt = "f".repeat(64);

    await expect(
      applyDevelopmentLoopTestWritingResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output,
        receiptSecret: "test-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow("Red evidence receipt is invalid");
  });

  it("serializes concurrent persistence so artifacts cannot be overwritten", async () => {
    const prepared = await prepareRun();
    const apply = () =>
      applyDevelopmentLoopTestWritingResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: outputForPlan(prepared.plan),
        receiptSecret: "test-secret",
        runId: prepared.runId,
      });

    const results = await Promise.allSettled([apply(), apply()]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(2);
    const values = results
      .filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof apply>>> =>
          result.status === "fulfilled",
      )
      .map(({ value }) => value);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "advanced" }),
        expect.objectContaining({ idempotent: true }),
      ]),
    );
  });
});
