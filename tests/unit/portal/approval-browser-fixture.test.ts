/** @vitest-environment node */

import { eq } from "drizzle-orm";
import { approvals, approvalTransitionEvents } from "@/db/schema";
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
