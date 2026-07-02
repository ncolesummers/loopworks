/** @vitest-environment node */
import { eq } from "drizzle-orm";

import {
  agentPlans,
  artifacts,
  loopRuns,
  observabilityEvents,
  repositories,
  runSteps,
} from "@/db/schema";
import {
  createDevelopmentLoopRun,
  createDevelopmentLoopRunSkeleton,
  developmentLoopStages,
  projectDevelopmentLoopArtifacts,
  projectDevelopmentLoopTimeline,
  recordDevelopmentLoopNoop,
  type DevelopmentLoopRunDatabase,
} from "@/lib/loops/development-run";
import { createPgliteTestDatabase, type PgliteTestDatabase } from "../../helpers/pglite";

const issueTrigger = {
  deliveryId: "issue-11-delivery",
  issueNumber: 11,
  issueUrl: "https://github.com/ncolesummers/loopworks/issues/11",
  labels: ["agent-ready", "area:loops", "area:agents", "loop:development", "priority:p0"],
  milestone: "M3 Durable Loop MVP",
  repositoryFullName: "ncolesummers/loopworks",
  title: "Agent-ready development loop skeleton",
};

function testDatabase(context: PgliteTestDatabase): DevelopmentLoopRunDatabase {
  return context.db as unknown as DevelopmentLoopRunDatabase;
}

async function insertRepository(context: PgliteTestDatabase) {
  await context.db.insert(repositories).values({
    githubRepoId: 11_000_001,
    owner: "ncolesummers",
    name: "loopworks",
    fullName: "ncolesummers/loopworks",
    enabledLoops: ["Agent-ready development loop"],
    validationGates: ["Focused tests", "Aggregate validation"],
  });
}

describe("agent-ready development loop run skeleton", () => {
  let context: PgliteTestDatabase;

  beforeEach(async () => {
    context = await createPgliteTestDatabase();
  });

  afterEach(async () => {
    await context.close();
  });

  it("defines the ordered issue #11 development stages with validation before review and PR", () => {
    expect(developmentLoopStages.map((stage) => stage.key)).toEqual([
      "planning",
      "test-writing",
      "development",
      "validation",
      "code-review",
      "commit",
      "pr",
      "done",
    ]);
    expect(developmentLoopStages.every((stage) => stage.artifact.required)).toBe(true);
    expect(developmentLoopStages.findIndex((stage) => stage.key === "validation")).toBeLessThan(
      developmentLoopStages.findIndex((stage) => stage.key === "code-review"),
    );
    expect(developmentLoopStages.findIndex((stage) => stage.key === "validation")).toBeLessThan(
      developmentLoopStages.findIndex((stage) => stage.key === "pr"),
    );
  });

  it("projects a simulated agent-ready run into visible timeline steps and artifact contracts", () => {
    const skeleton = createDevelopmentLoopRunSkeleton({
      mode: "simulated",
      now: new Date("2026-07-02T16:00:00.000Z"),
      trigger: issueTrigger,
    });

    const timeline = projectDevelopmentLoopTimeline(skeleton);
    const artifactRecords = projectDevelopmentLoopArtifacts(skeleton);

    expect(skeleton.stages).toHaveLength(8);
    expect(skeleton.artifacts).toHaveLength(8);
    expect(timeline.map((event) => event.title)).toEqual([
      "Planning",
      "Test writing",
      "Development",
      "Validation",
      "Code review",
      "Commit",
      "PR",
      "Done",
    ]);
    expect(timeline.every((event) => Boolean(event.artifact))).toBe(true);
    expect(artifactRecords.map((artifact) => artifact.label)).toEqual([
      "Plan artifact",
      "Red test evidence",
      "Patch artifact",
      "Validation report",
      "Code review notes",
      "Commit intent",
      "PR intent",
      "Completion summary",
    ]);
  });

  it("creates one durable run, eight stage rows, eight artifacts, and an agent plan", async () => {
    await insertRepository(context);

    const result = await createDevelopmentLoopRun({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:00:00.000Z"),
      trigger: issueTrigger,
    });

    expect(result).toMatchObject({
      artifactCount: 8,
      mode: "created",
      stageCount: 8,
    });

    const runRows = await context.db.select().from(loopRuns);
    const stepRows = await context.db.select().from(runSteps);
    const artifactRows = await context.db.select().from(artifacts);
    const planRows = await context.db.select().from(agentPlans);

    expect(runRows).toHaveLength(1);
    expect(runRows[0]).toMatchObject({
      currentStage: "planning",
      githubIssueNumber: 11,
      githubIssueUrl: issueTrigger.issueUrl,
      loopKey: "development-loop",
      status: "queued",
    });
    expect(stepRows.map((step) => step.stage)).toEqual(
      developmentLoopStages.map((stage) => stage.key),
    );
    expect(artifactRows).toHaveLength(8);
    expect(artifactRows.every((artifact) => artifact.runId === runRows[0]?.id)).toBe(true);
    expect(planRows).toHaveLength(1);
    expect(planRows[0]).toMatchObject({
      agentName: "eve-planning-agent",
      issueNumber: 11,
      status: "pending",
    });
  });

  it("is idempotent for a retried delivery after run creation", async () => {
    await insertRepository(context);

    const first = await createDevelopmentLoopRun({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:00:00.000Z"),
      trigger: issueTrigger,
    });
    const second = await createDevelopmentLoopRun({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:02:00.000Z"),
      trigger: issueTrigger,
    });

    expect(second).toEqual(first);
    expect(await context.db.select().from(loopRuns)).toHaveLength(1);
    expect(await context.db.select().from(runSteps)).toHaveLength(8);
    expect(await context.db.select().from(artifacts)).toHaveLength(8);
    expect(await context.db.select().from(agentPlans)).toHaveLength(1);
  });

  it("records a durable disabled-loop no-op without creating a run", async () => {
    await insertRepository(context);

    const result = await recordDevelopmentLoopNoop({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:01:00.000Z"),
      reason: "loop_disabled",
      trigger: issueTrigger,
    });

    expect(result).toEqual({
      mode: "noop",
      reason: "loop_disabled",
    });

    expect(await context.db.select().from(loopRuns)).toEqual([]);

    const [event] = await context.db
      .select()
      .from(observabilityEvents)
      .where(eq(observabilityEvents.eventType, "development_loop_noop"));
    expect(event).toMatchObject({
      correlationId: "issue-11-delivery",
      eventType: "development_loop_noop",
      severity: "info",
    });
    expect(event?.payload).toMatchObject({
      issueNumber: 11,
      reason: "loop_disabled",
      repositoryFullName: "ncolesummers/loopworks",
    });
  });

  it("is idempotent for repeated disabled-loop no-op recording", async () => {
    await insertRepository(context);

    const first = await recordDevelopmentLoopNoop({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:01:00.000Z"),
      reason: "loop_disabled",
      trigger: issueTrigger,
    });
    const second = await recordDevelopmentLoopNoop({
      database: testDatabase(context),
      now: () => new Date("2026-07-02T16:02:00.000Z"),
      reason: "loop_disabled",
      trigger: issueTrigger,
    });

    expect(second).toEqual(first);
    expect(
      await context.db
        .select()
        .from(observabilityEvents)
        .where(eq(observabilityEvents.eventType, "development_loop_noop")),
    ).toHaveLength(1);
  });
});
