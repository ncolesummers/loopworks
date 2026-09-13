import { eq } from "drizzle-orm";
import { agentPlans, approvals, approvalTransitionEvents, artifacts, loopRuns } from "@/db/schema";
import { type SeedDatabase, seedDemoData } from "@/lib/seed/demo-data";

export const approvalBrowserFixture = {
  approvalId: "27500000-0000-4000-8000-000000000275",
  planId: "27500000-0000-4000-8000-000000000276",
  artifactId: "27500000-0000-4000-8000-000000000277",
  sha256: "a".repeat(64),
  actor: "approval-browser-operator",
};

/** Restores this spec's gate before each attempt; unrelated audit rows are untouched. */
export async function prepareApprovalBrowserFixture(database: SeedDatabase) {
  await seedDemoData(database);
  return database.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(loopRuns)
      .where(eq(loopRuns.status, "waiting_for_approval"))
      .limit(1);
    if (!run) throw new Error("Seeded approval run missing");
    await tx
      .delete(approvalTransitionEvents)
      .where(eq(approvalTransitionEvents.approvalId, approvalBrowserFixture.approvalId));
    await tx
      .insert(agentPlans)
      .values({
        id: approvalBrowserFixture.planId,
        runId: run.id,
        input: {},
        status: "requested",
        plan: {
          summary: "Review the approval surface changes before writing tests.",
          identity: { sha256: approvalBrowserFixture.sha256 },
        },
      })
      .onConflictDoUpdate({ target: agentPlans.id, set: { status: "requested" } });
    await tx
      .insert(approvals)
      .values({
        id: approvalBrowserFixture.approvalId,
        runId: run.id,
        scope: "plan-review",
        requestedBy: "planner",
        status: "requested",
        note: "Requesting review before the preview promotes.",
        metadata: {
          planId: approvalBrowserFixture.planId,
          planSha256: approvalBrowserFixture.sha256,
        },
        requestedAt: new Date("2026-07-01T00:00:00Z"),
      })
      .onConflictDoUpdate({
        target: approvals.id,
        set: {
          status: "requested",
          resolvedBy: null,
          resolvedAt: null,
          note: "Requesting review before the preview promotes.",
        },
      });
    await tx
      .insert(artifacts)
      .values({
        id: approvalBrowserFixture.artifactId,
        runId: run.id,
        type: "plan",
        title: "Approval plan evidence",
        uri: "https://github.com/ncolesummers/loopworks/issues/275",
      })
      .onConflictDoNothing();
    return { ...approvalBrowserFixture, runId: run.id };
  });
}
