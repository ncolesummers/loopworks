/** @vitest-environment node */
import { createHash, randomUUID } from "node:crypto";

import {
  computeImplementationDigest,
  implementationAgentModelLabel,
  type ImplementationResult,
  implementationResultSchemaId,
} from "@agent/implementation-agent";
import { createImplementationExecutionReceipt } from "@agent/subagents/implementer/lib/tool-policy";
import {
  computeTestPlanDigest,
  redTestEvidenceSchemaId,
  testPlanSchemaId,
} from "@agent/test-writing-agent";
import { and, eq } from "drizzle-orm";

import { agentPlans, approvals, artifacts, loopRuns, repositories, runSteps } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import {
  createDevelopmentLoopRun,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import {
  applyDevelopmentLoopImplementationResult,
  type DevelopmentLoopTransitionDatabase,
} from "@/lib/loops/development-run-transitions";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe("implementation stage transition", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
    await context.db.insert(repositories).values({
      githubRepoId: 48_000_002,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
      enabledLoops: ["Agent-ready development loop"],
      validationGates: ["Focused tests", "bun run validate"],
    });
  });

  afterEach(async () => context.close());

  async function prepare() {
    const created = await createDevelopmentLoopRun({
      database: context.db as unknown as DevelopmentLoopRunDatabase,
      trigger: {
        body: "## Acceptance Criteria\n- Implementation makes the red test green.",
        issueNumber: 48,
        repositoryFullName: "ncolesummers/loopworks",
        repositoryRevision: { ref: "main", commitSha: "a".repeat(40) },
        title: "Implementation subagent",
      },
    });
    if (created.mode !== "created") throw new Error("Expected created run.");
    const [approval] = await context.db
      .select()
      .from(approvals)
      .where(eq(approvals.runId, created.runId));
    if (!approval) throw new Error("Expected plan approval.");
    await applyApprovalTransition({
      action: "approve",
      actorId: "maintainer",
      approvalId: approval.id,
      database: context.db as unknown as ApprovalTransitionDatabase,
      expectedStatus: "requested",
    });
    const [planRow] = await context.db
      .select()
      .from(agentPlans)
      .where(eq(agentPlans.runId, created.runId));
    const plan = planRow?.plan as { identity?: { id?: string; sha256?: string } };
    if (!plan.identity?.id || !plan.identity.sha256) throw new Error("Expected plan identity.");

    const testPatch = [
      "diff --git a/tests/unit/red.test.ts b/tests/unit/red.test.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tests/unit/red.test.ts",
      "@@ -0,0 +1 @@",
      "+expect(ready).toBe(true);",
    ].join("\n");
    const testPlan = {
      version: 1 as const,
      schemaId: testPlanSchemaId,
      plan: {
        id: plan.identity.id,
        sha256: plan.identity.sha256,
        repositoryFullName: "ncolesummers/loopworks",
        commitSha: "a".repeat(40),
      },
      acceptanceCriteria: [{ id: "ac-1", text: "Implementation makes the red test green." }],
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
        content: testPatch,
        sha256: sha256(testPatch),
        byteCount: Buffer.byteLength(testPatch),
        paths: ["tests/unit/red.test.ts"],
      },
    };
    const redEvidence = {
      version: 1 as const,
      schemaId: redTestEvidenceSchemaId,
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      results: [
        {
          id: "red-ac-1",
          testId: "test-ac-1",
          acceptanceCriterionIds: ["ac-1"],
          command: "bun run test -- tests/unit/red.test.ts",
          outcome: "expected_failure" as const,
          exitCode: 1,
          durationMs: 10,
          expectedAssertion: "expected false to be true",
          executionReceipt: "b".repeat(64),
          outputReference: {
            uri: "artifact://red.log",
            sha256: "c".repeat(64),
            byteCount: 10,
            redacted: true as const,
          },
        },
      ],
    };

    const [testStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, created.runId), eq(runSteps.stage, "test-writing")));
    const [developmentStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, created.runId), eq(runSteps.stage, "development")));
    if (!testStep || !developmentStep) throw new Error("Expected stage steps.");
    const testArtifacts = await context.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.stepId, testStep.id));
    const testPlanArtifact = testArtifacts.find(({ type }) => type === "test_plan");
    const redArtifact = testArtifacts.find(({ type }) => type === "validation_report");
    if (!testPlanArtifact || !redArtifact) throw new Error("Expected upstream artifacts.");
    await context.db
      .update(artifacts)
      .set({
        metadata: { testPlan, testPlanMetadataKind: "test_plan_result" },
        sha256: computeTestPlanDigest(testPlan),
      })
      .where(eq(artifacts.id, testPlanArtifact.id));
    await context.db
      .update(artifacts)
      .set({
        metadata: {
          redTestEvidence: redEvidence,
          redTestEvidenceMetadataKind: "red_test_evidence_result",
        },
        sha256: computeTestPlanDigest(redEvidence),
      })
      .where(eq(artifacts.id, redArtifact.id));
    await context.db
      .update(runSteps)
      .set({ status: "succeeded", validationStatus: "red", completedAt: new Date() })
      .where(eq(runSteps.id, testStep.id));
    await context.db
      .update(runSteps)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(runSteps.id, developmentStep.id));
    await context.db
      .update(loopRuns)
      .set({ currentStage: "development", status: "running" })
      .where(eq(loopRuns.id, created.runId));

    const patch = [
      "diff --git a/src/example.ts b/src/example.ts",
      "--- a/src/example.ts",
      "+++ b/src/example.ts",
      "@@ -1 +1 @@",
      "-export const ready = false;",
      "+export const ready = true;",
    ].join("\n");
    const binding = {
      planId: plan.identity.id,
      planSha256: plan.identity.sha256,
      testPlanSha256: computeTestPlanDigest(testPlan),
      testPatchSha256: testPlan.patch.sha256,
      fixturesSha256: computeImplementationDigest(testPlan.fixtures),
      repositoryFullName: "ncolesummers/loopworks",
      commitSha: "a".repeat(40),
    };
    const focusedOutput = sha256("PASS tests/unit/red.test.ts");
    const validationOutput = sha256("validate pass");
    const baseReceipt = {
      exitCode: 0,
      outcome: "pass" as const,
      planSha256: binding.planSha256,
      testPlanSha256: binding.testPlanSha256,
      testPatchSha256: binding.testPatchSha256,
      productionPatchSha256: sha256(patch),
    };
    const output: ImplementationResult = {
      version: 1,
      schemaId: implementationResultSchemaId,
      model: implementationAgentModelLabel,
      binding,
      patch: {
        format: "unified-diff",
        content: patch,
        sha256: sha256(patch),
        byteCount: Buffer.byteLength(patch),
        paths: ["src/example.ts"],
      },
      greenEvidence: [
        {
          id: "green-ac-1",
          testId: "test-ac-1",
          acceptanceCriterionIds: ["ac-1"],
          command: "bun run test -- tests/unit/red.test.ts",
          testPath: "tests/unit/red.test.ts",
          outcome: "pass",
          exitCode: 0,
          durationMs: 12,
          executionReceipt: createImplementationExecutionReceipt(
            {
              ...baseReceipt,
              kind: "focused",
              command: "bun run test -- tests/unit/red.test.ts",
              outputSha256: focusedOutput,
              testPaths: ["tests/unit/red.test.ts"],
            },
            "implementation-secret",
          ),
          outputReference: {
            uri: "artifact://green.log",
            sha256: focusedOutput,
            byteCount: 31,
            redacted: true,
          },
        },
      ],
      validationEvidence: {
        command: "bun run validate",
        outcome: "pass",
        exitCode: 0,
        durationMs: 30,
        executionReceipt: createImplementationExecutionReceipt(
          {
            ...baseReceipt,
            kind: "aggregate",
            command: "bun run validate",
            outputSha256: validationOutput,
            testPaths: [],
          },
          "implementation-secret",
        ),
        outputReference: {
          uri: "artifact://validate.log",
          sha256: validationOutput,
          byteCount: 13,
          redacted: true,
        },
      },
    };
    return { approvalId: approval.id, output, runId: created.runId };
  }

  it("persists the patch and advances complete green evidence to validation", async () => {
    const prepared = await prepare();
    const result = await applyDevelopmentLoopImplementationResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      output: prepared.output,
      receiptSecret: "implementation-secret",
      runId: prepared.runId,
    });
    expect(result).toMatchObject({ stage: "development", status: "advanced" });
    const [run] = await context.db.select().from(loopRuns).where(eq(loopRuns.id, prepared.runId));
    const [step] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "development")));
    const [artifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.runId, prepared.runId), eq(artifacts.stepId, step?.id ?? "")));
    expect(run?.currentStage).toBe("validation");
    expect(step).toMatchObject({ status: "succeeded", validationStatus: "green" });
    expect(artifact?.metadata).toMatchObject({
      implementationMetadataKind: "implementation_result",
      implementationResultSchemaId,
    });
    expect(artifact?.sha256).toBe(computeImplementationDigest(prepared.output));
  });

  it("rejects a receipt that is not bound to the production patch", async () => {
    const prepared = await prepare();
    const evidence = prepared.output.greenEvidence[0];
    if (!evidence) throw new Error("Expected green evidence.");
    evidence.executionReceipt = "0".repeat(64);
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow();
  });

  it("allows only an exact idempotent replay", async () => {
    const prepared = await prepare();
    await applyDevelopmentLoopImplementationResult({
      database: context.db as unknown as DevelopmentLoopTransitionDatabase,
      output: prepared.output,
      receiptSecret: "implementation-secret",
      runId: prepared.runId,
    });
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).resolves.toMatchObject({ idempotent: true });

    const different = structuredClone(prepared.output);
    different.validationEvidence.durationMs += 1;
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: different,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow("does not match the persisted result");
  });

  it("fails closed when plan approval is revoked before persistence", async () => {
    const prepared = await prepare();
    await context.db
      .update(approvals)
      .set({ status: "rejected" })
      .where(eq(approvals.id, prepared.approvalId));
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow("plan identity is invalid");
  });

  it("rejects red evidence that no longer matches the persisted test plan", async () => {
    const prepared = await prepare();
    const [testStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "test-writing")));
    if (!testStep) throw new Error("Expected test-writing step.");
    const rows = await context.db.select().from(artifacts).where(eq(artifacts.stepId, testStep.id));
    const redRow = rows.find(({ type }) => type === "validation_report");
    const redEvidence = structuredClone(redRow?.metadata?.redTestEvidence) as {
      results?: Array<{ command?: string }>;
    };
    if (!redRow || !redEvidence.results?.[0]) throw new Error("Expected red evidence.");
    redEvidence.results[0].command = "bun run test -- tests/unit/unrelated.test.ts";
    await context.db
      .update(artifacts)
      .set({
        metadata: { ...redRow.metadata, redTestEvidence: redEvidence },
        sha256: computeTestPlanDigest(redEvidence),
      })
      .where(eq(artifacts.id, redRow.id));
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow("does not match the persisted test plan");
  });

  it("rejects duplicate upstream handoff artifacts", async () => {
    const prepared = await prepare();
    const [testStep] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "test-writing")));
    if (!testStep) throw new Error("Expected test-writing step.");
    const [testPlanArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.stepId, testStep.id), eq(artifacts.type, "test_plan")));
    if (!testPlanArtifact) throw new Error("Expected test-plan artifact.");
    await context.db.insert(artifacts).values({
      id: randomUUID(),
      metadata: testPlanArtifact.metadata,
      runId: prepared.runId,
      sha256: testPlanArtifact.sha256,
      stepId: testStep.id,
      title: "Duplicate test plan",
      type: "test_plan",
      uri: "artifact://duplicate/test-plan",
    });
    await expect(
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ).rejects.toThrow("exactly one test plan");
  });

  it("serializes concurrent identical transitions without overwriting the patch", async () => {
    const prepared = await prepare();
    const results = await Promise.allSettled([
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
      applyDevelopmentLoopImplementationResult({
        database: context.db as unknown as DevelopmentLoopTransitionDatabase,
        output: prepared.output,
        receiptSecret: "implementation-secret",
        runId: prepared.runId,
      }),
    ]);
    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof applyDevelopmentLoopImplementationResult>>
      > => result.status === "fulfilled",
    );
    expect(fulfilled).toHaveLength(2);
    expect(fulfilled.some(({ value }) => value.idempotent === true)).toBe(true);
    const [step] = await context.db
      .select()
      .from(runSteps)
      .where(and(eq(runSteps.runId, prepared.runId), eq(runSteps.stage, "development")));
    const [patchArtifact] = await context.db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.stepId, step?.id ?? ""), eq(artifacts.type, "patch")));
    expect(patchArtifact?.sha256).toBe(computeImplementationDigest(prepared.output));
  });
});
