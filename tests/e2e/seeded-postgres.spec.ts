import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const dbBackedPortalPaths = ["/", "/catalog", "/loops", "/approvals", "/settings"] as const;

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
    await expect(page.getByText("Owner morgan-dev")).toBeVisible();
    await expect(page.getByText("Scope deploy-preview")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText("Live database", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("GitHub app connected")).toBeVisible();
    await page.getByRole("tab", { name: "Scoping" }).click();
    await expect(page.getByText("8 synced issue loops are visible.")).toBeVisible();
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
