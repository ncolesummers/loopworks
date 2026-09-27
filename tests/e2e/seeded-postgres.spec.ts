import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, type Route, type TestInfo, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getLocalDatabaseSafetyError } from "../../scripts/local-database-safety";
import * as schema from "../../src/db/schema";
import { approvalPlanFixture } from "../fixtures/approval-plan";
import {
  approvalBrowserFixture,
  prepareApprovalBrowserFixture,
} from "../helpers/approval-browser-fixture";

test.describe.configure({ mode: "serial" });
let client: ReturnType<typeof postgres>;
let database: ReturnType<typeof drizzle<typeof schema>>;
test.beforeAll(() => {
  const error = getLocalDatabaseSafetyError(process.env, { requireExplicitUrl: true });
  if (error) throw new Error(error);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for seeded tests");
  if (!["/loopworks_e2e", "/loopworks_275_surface"].includes(new URL(url).pathname))
    throw new Error("Seeded browser tests require a dedicated test database");
  client = postgres(url, { prepare: false });
  database = drizzle(client, { schema });
});
test.beforeEach(async () => {
  await prepareApprovalBrowserFixture(database);
});
test.afterAll(async () => {
  await client?.end();
});

async function retainScreenshot(page: Page, testInfo: TestInfo, name: string, region?: Locator) {
  const path = testInfo.outputPath(`${name}.png`);
  if (region) await region.screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

const dbBackedPortalPaths = ["/", "/catalog", "/loops", "/approvals", "/settings"] as const;

// Persona P01: the same protected route slices as the fixture walk, driven
// against a live database rather than seeded fixtures.
test.describe("seeded Postgres portal", () => {
  test("renders representative seeded records from the live database", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("ncolesummers/loopworks-web").first()).toBeVisible();

    await page.goto("/catalog");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    const loopworksRow = page.getByRole("row", { name: /ncolesummers\/loopworks-web/ });
    await expect(loopworksRow).toBeVisible();
    await expect(loopworksRow.getByText("prj_demo_loopworks_web")).toBeVisible();

    await page.goto("/loops");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("switch", { name: "Intake new repo requests" })).toBeChecked();

    await page.goto("/approvals");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Requested by morgan-dev").first()).toBeVisible();
    await expect(page.getByText("Scope deploy-preview").first()).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("GitHub app connected")).toBeVisible();
    await page.getByRole("tab", { name: "Scoping" }).click();
    await expect(page.getByText("8 synced issue loops are visible.")).toBeVisible();
  });

  // Persona A02: partial approval coverage; the full persona journey remains tracked by #266.
  test("approval decisions retain evidence, reject unsafe responses, and survive reload", async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/approvals");
    const gates = page.getByRole("list", { name: "Approval gates", includeHidden: true });
    await expect(gates.locator(":scope > li")).toHaveCount(7);
    const requested = gates.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
    const evidence = requested.getByText("Scope plan-review", { exact: true });
    await expect(requested.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await expect(
      requested.getByRole("heading", { name: "Proposed steps", exact: true }),
    ).toBeVisible();
    await expect(requested.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
    await requested.getByText("Technical details", { exact: true }).click();
    await expect(
      requested.getByText(approvalBrowserFixture.planId, { exact: false }).first(),
    ).toBeVisible();
    await expect(
      requested.getByText(approvalBrowserFixture.sha256, { exact: false }).first(),
    ).toBeVisible();
    await requested.getByText("Technical details", { exact: true }).click();
    await expect(evidence).toBeVisible();
    await requested.getByRole("button", { name: /Review approval/ }).click();

    for (const status of [401, 403, 404, 409]) {
      await page.route("**/api/approvals/transition", (route) =>
        route.fulfill({
          status,
          json: { error: "internal-detail other-user-id" },
        }),
      );
      const rejectedResponse = page.waitForResponse("**/api/approvals/transition");
      await page.getByRole("button", { name: /Confirm approval/ }).click();
      expect((await rejectedResponse).status()).toBe(status);
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("alert")).not.toContainText(/internal-detail|other-user-id/);
      await expect(
        page.getByRole("dialog").getByRole("link", { name: "Approval plan evidence" }),
      ).toBeVisible();
      await expect(
        page.getByRole("dialog").getByText(approvalPlanFixture.summary, { exact: true }),
      ).toBeVisible();
      await page.unroute("**/api/approvals/transition");
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.reload();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.setViewportSize({ width: 390, height: 844 });
      await requested.getByRole("button", { name: /Review approval/ }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        391,
      );
      await page.keyboard.press("Escape");
      await expect(requested.getByRole("button", { name: /Review approval/ })).toBeFocused();
    }

    await requested.getByRole("button", { name: /Review approval/ }).click();
    await page.getByLabel("Reviewer notes").fill("Evidence checked in the approval browser test.");
    const responsePromise = page.waitForResponse("**/api/approvals/transition");
    await page.getByRole("button", { name: /Reject approval/ }).focus();
    await page.keyboard.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      approvalId: expect.any(String),
      expectedStatus: "requested",
      action: "reject",
      note: "Evidence checked in the approval browser test.",
    });
    const decision = await response.json();
    expect(decision.transition.to).toBe("rejected");
    await expect(requested.getByRole("status")).toBeFocused();
    await expect(requested.getByRole("status")).toContainText("Rejected");
    await expect(requested.getByRole("button", { name: /Review approval/ })).toHaveCount(0);
    await expect(requested.getByRole("status")).toBeFocused();
    await expect(requested.getByRole("status")).toContainText("Decision saved.");
    await expect(requested.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await requested.getByRole("status").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await retainScreenshot(page, testInfo, "rejected-saved-mobile-dark");
    expect(decision.transition.actorId).toBe(approvalBrowserFixture.actor);
    const [event] = await database
      .select()
      .from(schema.approvalTransitionEvents)
      .where(eq(schema.approvalTransitionEvents.approvalId, approvalBrowserFixture.approvalId));
    expect(event).toMatchObject({
      actorId: approvalBrowserFixture.actor,
      metadata: { authMode: "fixture" },
    });
    await page.reload();
    const resolved = gates.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
    await expect(resolved.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(
      resolved.getByText(`Resolved by ${approvalBrowserFixture.actor}`, { exact: true }),
    ).toBeVisible();
    await expect(resolved.getByText("Requested by planner", { exact: true })).toBeVisible();
    await expect(resolved.getByText("Scope plan-review", { exact: true })).toBeVisible();
    await expect(
      resolved.getByText("Requesting review before this exact plan proceeds to test writing.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resolved.getByText("Decision note: Evidence checked in the approval browser test.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(resolved.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await expect(resolved.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
    await expect(
      resolved.getByText(approvalPlanFixture.risks[0].mitigation, { exact: true }),
    ).toBeVisible();
    await resolved.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await retainScreenshot(page, testInfo, "rejected-reloaded-mobile-dark");
    expect(pageErrors).toEqual([]);
  });

  test("approval confirmation persists the exact gate and retains review evidence after reload", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/approvals");
    await page.evaluate(() => localStorage.setItem("theme", "light"));
    await page.reload();
    const gate = page.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
    await gate.getByRole("button", { name: /Review approval/ }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
    await dialog.getByLabel("Reviewer notes").fill("Reviewed the exact plan before test writing.");
    const responsePromise = page.waitForResponse("**/api/approvals/transition");
    await dialog.getByRole("button", { name: /Confirm approval/ }).focus();
    await page.keyboard.press("Enter");
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({
      approvalId: approvalBrowserFixture.approvalId,
      expectedStatus: "requested",
      action: "approve",
      note: "Reviewed the exact plan before test writing.",
    });
    expect((await response.json()).transition).toMatchObject({
      to: "approved",
      actorId: approvalBrowserFixture.actor,
    });
    await expect(gate.getByRole("status")).toBeFocused();
    await expect(gate.getByRole("status")).toContainText("Approved");
    await expect(gate.getByRole("button", { name: /Review approval/ })).toHaveCount(0);
    await expect(gate.getByRole("status")).toBeFocused();
    await expect(gate.getByRole("status")).toContainText("Decision saved.");
    await expect(gate.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await gate.getByRole("status").evaluate((node) => node.scrollIntoView({ block: "start" }));
    await retainScreenshot(page, testInfo, "approved-saved-mobile-light");
    const [event] = await database
      .select()
      .from(schema.approvalTransitionEvents)
      .where(eq(schema.approvalTransitionEvents.approvalId, approvalBrowserFixture.approvalId));
    expect(event).toMatchObject({
      actorId: approvalBrowserFixture.actor,
      toStatus: "approved",
      metadata: { authMode: "fixture" },
    });
    await page.reload();
    await expect(gate.getByText("Approved", { exact: true })).toBeVisible();
    await expect(
      gate.getByText(`Resolved by ${approvalBrowserFixture.actor}`, { exact: true }),
    ).toBeVisible();
    await expect(
      gate.getByText("Decision note: Reviewed the exact plan before test writing.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(gate.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
    await expect(
      gate.getByText(approvalPlanFixture.risks[0].mitigation, { exact: true }),
    ).toBeVisible();
    await expect(gate.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await expect(gate.getByRole("button", { name: /Review approval/ })).toHaveCount(0);
    await gate.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await retainScreenshot(page, testInfo, "approved-reloaded-mobile-light");
  });

  test("a persisted approval remains saved when the following refresh times out", async ({
    page,
  }, testInfo) => {
    test.setTimeout(45_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/approvals");
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    await page.reload();
    const gate = page.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
    await gate.getByRole("button", { name: /Review approval/ }).click();
    const heldRefreshes: Promise<void>[] = [];
    let releaseRefresh: (() => void) | undefined;
    const refreshRelease = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const holdRefresh = async (route: Route) => {
      if (
        new URL(route.request().url()).pathname === "/approvals" &&
        route.request().headers().rsc === "1"
      ) {
        const resumed = refreshRelease.then(() => route.continue());
        heldRefreshes.push(resumed);
        await resumed;
        return;
      }
      await route.continue();
    };
    await page.route("**/approvals**", holdRefresh);
    try {
      const responsePromise = page.waitForResponse("**/api/approvals/transition");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /Confirm approval/ })
        .click();
      expect((await responsePromise).status()).toBe(200);
      await expect(gate.getByRole("status")).toContainText("Approved");
      await expect(gate.getByRole("status")).toBeFocused();
      await expect(gate.getByRole("alert")).toContainText("Decision saved. Reload", {
        timeout: 15_000,
      });
      expect(heldRefreshes.length).toBeGreaterThan(0);
      await expect(gate.getByRole("button", { name: /Review approval/ })).toBeDisabled();
      await expect(gate.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
      await expect(gate.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
      await expect(gate.getByRole("link", { name: "Reload approvals" })).toHaveAttribute(
        "href",
        "/approvals",
      );
      const [saved] = await database
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, approvalBrowserFixture.approvalId));
      expect(saved).toMatchObject({ status: "approved", resolvedBy: approvalBrowserFixture.actor });
      const events = await database
        .select()
        .from(schema.approvalTransitionEvents)
        .where(eq(schema.approvalTransitionEvents.approvalId, approvalBrowserFixture.approvalId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        toStatus: "approved",
        actorId: approvalBrowserFixture.actor,
        metadata: { authMode: "fixture" },
      });
      await gate.getByRole("status").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await retainScreenshot(page, testInfo, "approved-refresh-timeout-mobile-dark");
    } finally {
      releaseRefresh?.();
      try {
        await Promise.all(heldRefreshes);
      } finally {
        await page.unroute("**/approvals**", holdRefresh);
      }
    }
    // The refresh was held, never aborted: there is no intentional browser error to suppress.
    await expect(gate.getByRole("alert")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`structured approval review at ${width}px in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto("/approvals");
        await page.evaluate((value) => localStorage.setItem("theme", value), theme);
        await page.reload();
        await expect(page.locator("html")).toHaveClass(new RegExp(theme));
        const gate = page.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
        for (const heading of [
          "Summary",
          "Proposed steps",
          "Planned validation",
          "Risks and mitigations",
          "What approval permits",
        ]) {
          await expect(gate.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        }
        await expect(
          gate.getByRole("link", { name: approvalPlanFixture.issue.title, exact: true }),
        ).toHaveAttribute("href", approvalPlanFixture.issue.url);
        await expect(
          gate.getByText(`${approvalPlanFixture.issue.repositoryFullName} · Issue #275`, {
            exact: true,
          }),
        ).toBeVisible();
        for (const step of approvalPlanFixture.steps) {
          await expect(gate.getByText(step.title, { exact: true })).toBeVisible();
          await expect(gate.getByText(step.outcome, { exact: true })).toBeVisible();
        }
        for (const risk of approvalPlanFixture.risks) {
          await expect(gate.getByText(risk.description, { exact: true })).toBeVisible();
          await expect(gate.getByText(risk.mitigation, { exact: true })).toBeVisible();
        }
        await expect(
          gate.getByText("Verified against the current portal state", { exact: false }),
        ).toHaveCount(0);
        const prose = gate.getByText(approvalPlanFixture.summary, { exact: true });
        expect(await prose.evaluate((node) => getComputedStyle(node).wordBreak)).not.toBe(
          "break-all",
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width + 1,
        );
        await retainScreenshot(page, testInfo, `requested-gate-${width}-${theme}`, gate);
        await gate.evaluate((node) => node.scrollIntoView({ block: "start" }));
        await retainScreenshot(page, testInfo, `requested-viewport-${width}-${theme}`);
        const trigger = gate.getByRole("button", { name: /Review approval/ });
        await trigger.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByText("Requesting review before this exact plan proceeds to test writing.", {
            exact: true,
          }),
        ).toBeVisible();
        await retainScreenshot(page, testInfo, `request-context-${width}-${theme}`);
        await expect(dialog.getByText(approvalPlanFixture.summary, { exact: true })).toBeVisible();
        await expect(
          dialog.getByRole("heading", { name: "What approval permits", exact: true }),
        ).toBeVisible();
        await expect(
          dialog.getByText(approvalPlanFixture.steps[1].outcome, { exact: true }),
        ).toBeVisible();
        await dialog
          .getByRole("heading", { name: "What approval permits", exact: true })
          .evaluate((node) => node.scrollIntoView({ block: "start" }));
        await retainScreenshot(page, testInfo, `decision-summary-${width}-${theme}`);
        const evidenceLink = dialog.getByRole("link", { name: "Approval plan evidence" });
        await evidenceLink.focus();
        await expect(evidenceLink).toBeFocused();
        await expect(evidenceLink).toBeVisible();
        const technicalDetails = dialog.getByText("Technical details", { exact: true });
        await technicalDetails.focus();
        await page.keyboard.press("Enter");
        await expect(
          dialog.getByText(approvalBrowserFixture.sha256, { exact: false }).first(),
        ).toBeVisible();
        await technicalDetails.evaluate((node) => node.scrollIntoView({ block: "start" }));
        await retainScreenshot(page, testInfo, `decision-technical-${width}-${theme}`);
        await technicalDetails.focus();
        await page.keyboard.press("Enter");
        await expect(
          dialog.getByText(approvalBrowserFixture.sha256, { exact: false }).first(),
        ).toBeHidden();
        const confirm = dialog.getByRole("button", { name: /Confirm approval/ });
        await confirm.focus();
        await expect(confirm).toBeFocused();
        await expect(confirm).toBeInViewport();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          width + 1,
        );
        await retainScreenshot(page, testInfo, `decision-controls-${width}-${theme}`);
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      });
    }
  }

  test("keeps every database-backed page inside the mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const path of dbBackedPortalPaths) {
      await page.goto(path);
      await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();

      const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);

      expect(scrollWidth, `${path} should not create horizontal page overflow`).toBeLessThanOrEqual(
        viewportWidth + 1,
      );
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`color scheme: ${colorScheme}`, () => {
      test.use({ colorScheme });

      test("has no a11y violations on database-backed pages", async ({ page }) => {
        for (const path of dbBackedPortalPaths) {
          await page.goto(path);
          await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations, `${colorScheme} ${path}`).toEqual([]);
        }
      });
    });
  }
});
