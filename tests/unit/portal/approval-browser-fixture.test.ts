/** @vitest-environment node */

import {
  computePlanningArtifactDigest,
  pinnedPlanningAgentOutputSchema,
} from "@agent/planning-agent";
import { eq } from "drizzle-orm";
import { agentPlans, approvals, approvalTransitionEvents, artifacts } from "@/db/schema";
import { applyApprovalTransition } from "@/lib/approval-transitions";
import type { ApprovalTransitionDatabase } from "@/lib/approvals";
import type { SeedDatabase } from "@/lib/seed/demo-data";
import { prepareApprovalBrowserFixture } from "../../helpers/approval-browser-fixture";
import {
  createPgliteTestDatabase,
  type PgliteTestDatabase,
  pgliteTestHookTimeoutMs,
} from "../../helpers/pglite";

let context: PgliteTestDatabase;
beforeAll(async () => {
  context = await createPgliteTestDatabase();
}, pgliteTestHookTimeoutMs);
beforeEach(async () => {
  await context.reset();
}, pgliteTestHookTimeoutMs);
afterAll(async () => {
  await context.close();
}, pgliteTestHookTimeoutMs);
it("F6 each browser attempt restores its requested gate and clears only its previous decision", async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const fixture = await prepareApprovalBrowserFixture(context.db as unknown as SeedDatabase);
    expect(
      (await context.db.select().from(approvals).where(eq(approvals.id, fixture.approvalId)))[0]
        .status,
    ).toBe("requested");
    expect(
      await context.db
        .select()
        .from(approvalTransitionEvents)
        .where(eq(approvalTransitionEvents.approvalId, fixture.approvalId)),
    ).toHaveLength(0);
    await applyApprovalTransition({
      approvalId: fixture.approvalId,
      expectedStatus: "requested",
      action: "reject",
      actorId: "approval-browser-operator",
      authMode: "fixture",
      database: context.db as unknown as ApprovalTransitionDatabase,
    });
  }
});

it("restores schema-valid long review content and exact binding on repeated preparation", async () => {
  const fixture = await prepareApprovalBrowserFixture(context.db as unknown as SeedDatabase);
  const readPlan = async () =>
    (await context.db.select().from(agentPlans).where(eq(agentPlans.id, fixture.planId)))[0];
  const original = await readPlan();
  const parsed = pinnedPlanningAgentOutputSchema.parse(original.plan);
  expect(parsed.identity.sha256).toBe(computePlanningArtifactDigest(parsed));
  expect(parsed.steps.length).toBeGreaterThanOrEqual(3);
  expect(parsed.risks.length).toBeGreaterThanOrEqual(2);
  expect(parsed.summary.length).toBeGreaterThan(180);
  await context.db
    .update(agentPlans)
    .set({ plan: { summary: "Stale incomplete plan" }, input: {}, status: "rejected" })
    .where(eq(agentPlans.id, fixture.planId));
  await context.db
    .update(approvals)
    .set({ scope: "stale-scope", requestedBy: "stale-requester", metadata: {} })
    .where(eq(approvals.id, fixture.approvalId));
  await context.db
    .update(artifacts)
    .set({ title: "Stale evidence", uri: "https://github.com/ncolesummers/loopworks/issues/1" })
    .where(eq(artifacts.id, fixture.artifactId));
  await prepareApprovalBrowserFixture(context.db as unknown as SeedDatabase);
  expect(await readPlan()).toMatchObject({
    plan: original.plan,
    input: original.input,
    runId: fixture.runId,
    status: "requested",
  });
  expect(
    (await context.db.select().from(approvals).where(eq(approvals.id, fixture.approvalId)))[0],
  ).toMatchObject({
    scope: "plan-review",
    requestedBy: "planner",
    metadata: { planId: fixture.planId, planSha256: parsed.identity.sha256 },
  });
  expect(
    (await context.db.select().from(artifacts).where(eq(artifacts.id, fixture.artifactId)))[0],
  ).toMatchObject({
    title: "Approval plan evidence",
    uri: "https://github.com/ncolesummers/loopworks/issues/275",
    runId: fixture.runId,
  });
});
