/** @vitest-environment node */

import { context as otelContext, type Span, TraceFlags, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";

import {
  agentPlans,
  approvals,
  artifacts,
  idempotencyLocks,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import {
  createResearchLoopRun,
  createResearchLoopRunSkeleton,
  getNextResearchLoopStage,
  projectResearchLoopArtifacts,
  projectResearchLoopTimeline,
  type ResearchLoopRunDatabase,
  recordResearchLoopNoop,
  researchLoopStages,
  simulateResearchLoopRun,
} from "@/lib/loops/research-run";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const issueTrigger = {
  body: "Prove that the neutral orchestrator can route a non-code loop.",
  deliveryId: "issue-43-delivery",
  issueNumber: 43,
  issueUrl: "https://github.com/ncolesummers/loopworks/issues/43",
  labels: ["agent-ready", "spike", "area:loops", "loop:research", "priority:p2"],
  milestone: "M3 Durable Loop MVP",
  repositoryFullName: "ncolesummers/loopworks",
  title: "Research loop skeleton",
};

function testDatabase(context: PgliteTestDatabase): ResearchLoopRunDatabase {
  return context.db as unknown as ResearchLoopRunDatabase;
}

async function insertRepository(context: PgliteTestDatabase) {
  await context.db.insert(repositories).values({
    githubRepoId: 43_000_001,
    owner: "ncolesummers",
    name: "loopworks",
    fullName: "ncolesummers/loopworks",
    enabledLoops: ["Research routing"],
    validationGates: ["Focused tests", "Aggregate validation"],
  });
}

function withTestTrace<T>(callback: () => T): T {
  const span = {
    spanContext: () => ({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
    }),
  } as Span;

  return otelContext.with(trace.setSpan(otelContext.active(), span), callback);
}

describe("spike agent-ready research loop run skeleton", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("defines a deterministic non-code stage and artifact contract", () => {
    expect(researchLoopStages).toEqual([
      expect.objectContaining({
        actorId: "research-planner",
        artifact: expect.objectContaining({ kind: "research_plan", type: "plan" }),
        key: "planning",
        timelineKind: "planning",
      }),
      expect.objectContaining({
        actorId: "researcher",
        artifact: expect.objectContaining({
          cardinality: "one_per_subquestion",
          isolation: "child_session",
          kind: "findings",
          type: "other",
        }),
        key: "researching",
        timelineKind: "research",
      }),
      expect.objectContaining({
        actorId: "research-author",
        artifact: expect.objectContaining({ kind: "research_document", type: "other" }),
        key: "authoring",
        timelineKind: "authoring",
      }),
      expect.objectContaining({
        actorId: "loopworks",
        artifact: expect.objectContaining({ kind: "completion_summary", type: "other" }),
        key: "done",
        timelineKind: "done",
      }),
    ]);
    expect(researchLoopStages.map((stage) => stage.key)).not.toEqual(
      expect.arrayContaining(["test-writing", "development", "validation", "pr"]),
    );
    expect(getNextResearchLoopStage("planning")).toBe("researching");
    expect(getNextResearchLoopStage("researching")).toBe("authoring");
    expect(getNextResearchLoopStage("authoring")).toBe("done");
    expect(getNextResearchLoopStage("done")).toBeNull();
  });

  it("projects a simulated fixture into four visible timeline and artifact records", () => {
    const skeleton = createResearchLoopRunSkeleton({
      mode: "simulated",
      now: new Date("2026-07-22T02:00:00.000Z"),
      trigger: issueTrigger,
    });

    expect(
      simulateResearchLoopRun({ now: new Date("2026-07-22T02:00:00.000Z"), trigger: issueTrigger }),
    ).toEqual({
      artifactCount: 4,
      mode: "simulated",
      stageCount: 4,
    });
    expect(projectResearchLoopTimeline(skeleton).map((event) => event.title)).toEqual([
      "Planning",
      "Researching",
      "Authoring",
      "Done",
    ]);
    expect(projectResearchLoopArtifacts(skeleton).map((artifact) => artifact.label)).toEqual([
      "Research plan",
      "Findings artifacts",
      "Research document",
      "Completion summary",
    ]);
  });

  it("creates one durable traced run with four steps and artifact placeholders", async () => {
    await insertRepository(context);

    const result = await withTestTrace(() =>
      createResearchLoopRun({
        database: testDatabase(context),
        now: () => new Date("2026-07-22T02:00:00.000Z"),
        trigger: issueTrigger,
      }),
    );

    expect(result).toMatchObject({ artifactCount: 4, mode: "created", stageCount: 4 });
    const [run] = await context.db.select().from(loopRuns);
    const steps = await context.db.select().from(runSteps);
    const artifactRows = await context.db.select().from(artifacts);
    const [event] = await context.db
      .select()
      .from(observabilityEvents)
      .where(eq(observabilityEvents.eventType, "research_loop_run_created"));

    expect(run).toMatchObject({
      currentStage: "planning",
      githubIssueNumber: 43,
      loopKey: "research-loop",
      status: "queued",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(steps.map((step) => step.stage)).toEqual([
      "planning",
      "researching",
      "authoring",
      "done",
    ]);
    expect(steps.every((step) => step.traceId === run?.traceId)).toBe(true);
    expect(artifactRows).toHaveLength(4);
    expect(artifactRows.map((artifact) => artifact.metadata?.researchArtifactKind)).toEqual([
      "research_plan",
      "findings",
      "research_document",
      "completion_summary",
    ]);
    expect(artifactRows[1]?.metadata).toMatchObject({
      cardinality: "one_per_subquestion",
      isolation: "child_session",
    });
    expect(event).toMatchObject({
      eventType: "research_loop_run_created",
      metricName: "research_loop_run_created",
      runId: run?.id,
      traceId: run?.traceId,
    });
    expect(await context.db.select().from(agentPlans)).toEqual([]);
    expect(await context.db.select().from(approvals)).toEqual([]);
  });

  it("is idempotent for a repeated delivery and rejects unknown repositories", async () => {
    await insertRepository(context);

    const [first, second] = await Promise.all([
      createResearchLoopRun({ database: testDatabase(context), trigger: issueTrigger }),
      createResearchLoopRun({ database: testDatabase(context), trigger: issueTrigger }),
    ]);

    expect(second).toEqual(first);
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
    expect(await context.db.select().from(runSteps)).toHaveLength(4);
    expect(await context.db.select().from(artifacts)).toHaveLength(4);
    expect(await context.db.select().from(idempotencyLocks)).toEqual([
      expect.objectContaining({
        key: "research-loop:run:issue-43-delivery",
        scope: "research-loop",
        status: "released",
      }),
    ]);

    await expect(
      createResearchLoopRun({
        database: testDatabase(context),
        trigger: {
          ...issueTrigger,
          deliveryId: "unknown-repository",
          repositoryFullName: "ncolesummers/missing",
        },
      }),
    ).rejects.toThrow("Cannot create research loop run for unknown repository");
  });

  it("records one research-specific disabled no-op without creating a run", async () => {
    await insertRepository(context);

    const [first, second] = await Promise.all([
      recordResearchLoopNoop({
        database: testDatabase(context),
        now: () => new Date("2026-07-22T02:01:00.000Z"),
        reason: "loop_disabled",
        trigger: issueTrigger,
      }),
      recordResearchLoopNoop({
        database: testDatabase(context),
        now: () => new Date("2026-07-22T02:02:00.000Z"),
        reason: "loop_disabled",
        trigger: issueTrigger,
      }),
    ]);

    expect(second).toEqual(first);
    expect(first).toEqual({ mode: "noop", reason: "loop_disabled" });
    expect(await context.db.select().from(loopRuns)).toEqual([]);
    const events = await context.db.select().from(observabilityEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      correlationId: "issue-43-delivery",
      eventType: "research_loop_noop",
      payload: expect.objectContaining({
        issueNumber: 43,
        loopKey: "research-loop",
        reason: "loop_disabled",
      }),
    });
    expect(await context.db.select().from(idempotencyLocks)).toEqual([
      expect.objectContaining({
        key: "research-loop:noop:issue-43-delivery",
        scope: "research-loop",
        status: "released",
      }),
    ]);
  });
});
