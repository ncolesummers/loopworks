/** @vitest-environment node */
import { agentPlans, approvals, artifacts, loopRuns, repositories } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import { readPortalRecords } from "@/lib/portal/records";
import { readRunRecords } from "@/lib/runs/run-record";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

let context: PgliteTestDatabase;
const runId = "27500000-0000-4000-8000-000000000001";
const approvalId = "27500000-0000-4000-8000-000000000002";
const planId = "27500000-0000-4000-8000-000000000003";
const sha256 = "a".repeat(64);
beforeAll(async () => {
  context = await createPgliteTestDatabase();
}, pgliteTestHookTimeoutMs);
beforeEach(async () => {
  await context.reset();
  const [repo] = await context.db
    .insert(repositories)
    .values({
      githubRepoId: 275,
      owner: "ncolesummers",
      name: "loopworks",
      fullName: "ncolesummers/loopworks",
    })
    .returning();
  await context.db.insert(loopRuns).values({
    id: runId,
    repositoryId: repo.id,
    loopKey: "development-loop",
    status: "waiting_for_approval",
  });
  await context.db.insert(approvals).values({
    id: approvalId,
    runId,
    scope: "pr-write",
    requestedBy: "planner",
    note: "Requester context must survive.",
    requestedAt: new Date("2026-09-13T00:00:00Z"),
  });
}, pgliteTestHookTimeoutMs);
afterAll(async () => {
  await context.close();
}, pgliteTestHookTimeoutMs);

it("F1 carries linked plan content, id and digest through the portal read", async () => {
  await context.db.insert(agentPlans).values({
    id: planId,
    runId,
    input: {},
    plan: { summary: "Review <script>plain text</script>", identity: { sha256 } },
  });
  await context.db.insert(approvals).values({
    runId,
    scope: "plan-review",
    requestedBy: "planner",
    metadata: { planId, planSha256: sha256 },
  });
  const { records } = await readPortalRecords({ database: context.db });
  expect(records.approvals.find((gate) => gate.scope === "plan-review")?.plan).toEqual({
    id: planId,
    sha256,
    content: JSON.stringify(
      { summary: "Review <script>plain text</script>", identity: { sha256 } },
      null,
      2,
    ),
  });
});

it("F2 preserves requester context and exposes the separate audit note after a real transition and read", async () => {
  await applyApprovalTransition({
    approvalId,
    expectedStatus: "requested",
    action: "reject",
    actorId: "ncolesummers",
    note: "Reviewer decision.",
    database: context.db as unknown as ApprovalTransitionDatabase,
  });
  const { records } = await readPortalRecords({ database: context.db });
  expect(records.approvals[0].risk).toBe("Requester context must survive.");
  expect(records.approvals[0].decisionNote).toBe("Reviewer decision.");
  const runs = await readRunRecords({ database: context.db });
  expect(runs.runs[0].approvals[0]).toMatchObject({
    note: "Requester context must survive.",
    decisionNote: "Reviewer decision.",
  });
});

it("F4 maps the actionable run artifact before and after a persisted decision", async () => {
  await context.db.insert(artifacts).values({
    runId,
    type: "plan",
    title: "Approval plan evidence",
    uri: "https://github.com/ncolesummers/loopworks/issues/275",
  });
  const read = () => readPortalRecords({ database: context.db });
  expect((await read()).records.approvals[0].artifacts).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: "Approval plan evidence" })]),
  );
  await applyApprovalTransition({
    approvalId,
    expectedStatus: "requested",
    action: "approve",
    actorId: "ncolesummers",
    database: context.db as unknown as ApprovalTransitionDatabase,
  });
  expect((await read()).records.approvals[0].artifacts).toEqual(
    expect.arrayContaining([expect.objectContaining({ label: "Approval plan evidence" })]),
  );
});

it("F7 excludes gates without a visible run and caps the collection at 100", async () => {
  await context.db.insert(approvals).values({ scope: "orphan", requestedBy: "planner" });
  let records = (await readPortalRecords({ database: context.db })).records;
  expect(records.approvals.map((gate) => gate.scope)).not.toContain("orphan");
  await context.db.insert(approvals).values(
    Array.from({ length: 105 }, (_, i) => ({
      runId,
      scope: `gate-${i}`,
      requestedBy: "planner",
    })),
  );
  records = (await readPortalRecords({ database: context.db })).records;
  expect(records.approvals).toHaveLength(100);
});

it("F7 only projects gates from the 50 most recent visible runs", async () => {
  const [repo] = await context.db.select().from(repositories);
  await context.db.insert(loopRuns).values(
    Array.from({ length: 50 }, () => ({
      repositoryId: repo.id,
      loopKey: "development-loop",
      queuedAt: new Date("2030-01-01T00:00:00Z"),
    })),
  );
  expect((await readPortalRecords({ database: context.db })).records.approvals).toEqual([]);
});

it("F3 keeps gate ordering stable across state transitions", async () => {
  await context.db.insert(approvals).values({
    runId,
    scope: "second",
    status: "approved",
    requestedBy: "planner",
    requestedAt: new Date("2026-09-13T00:01:00Z"),
  });
  const before = (await readPortalRecords({ database: context.db })).records.approvals.map(
    (gate) => gate.id,
  );
  await applyApprovalTransition({
    approvalId,
    expectedStatus: "requested",
    action: "approve",
    actorId: "ncolesummers",
    database: context.db as unknown as ApprovalTransitionDatabase,
  });
  expect(
    (await readPortalRecords({ database: context.db })).records.approvals.map((gate) => gate.id),
  ).toEqual(before);
});

it("F7 enforces the explicit 100 gate upper bound", async () => {
  await context.db.insert(approvals).values(
    Array.from({ length: 105 }, (_, i) => ({
      runId,
      scope: `bound-${i}`,
      requestedBy: "planner",
    })),
  );
  expect((await readPortalRecords({ database: context.db })).records.approvals).toHaveLength(100);
});
