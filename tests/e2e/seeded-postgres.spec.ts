import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getLocalDatabaseSafetyError } from "../../scripts/local-database-safety";
import * as schema from "../../src/db/schema";
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
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/approvals");
    const gates = page.getByRole("list", { name: "Approval gates", includeHidden: true });
    await expect(gates.locator(":scope > li")).toHaveCount(7);
    const requested = gates.locator(`[data-approval-id="${approvalBrowserFixture.approvalId}"]`);
    const evidence = requested.getByText("Scope plan-review", { exact: true });
    await expect(requested.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    await expect(requested.getByText(`Plan ${approvalBrowserFixture.planId}`)).toBeVisible();
    await expect(requested.getByText(`SHA256 ${approvalBrowserFixture.sha256}`)).toBeVisible();
    await expect(requested.getByText(/Review the approval surface changes/)).toBeVisible();
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
      await expect(evidence).toBeVisible();
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
    await expect(requested.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
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
      resolved.getByText("Requesting review before the preview promotes.", { exact: true }),
    ).toBeVisible();
    await expect(
      resolved.getByText("Decision note: Evidence checked in the approval browser test.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(resolved.getByRole("link", { name: "Approval plan evidence" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

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
