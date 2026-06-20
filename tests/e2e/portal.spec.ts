import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("Loopworks portal", () => {
  test("renders the dashboard surface", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Repo catalog" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Vercel deployments and previews" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Loop registry" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approval gate" })).toBeVisible();
  });

  test("lets the operator toggle a loop and open GitHub settings", async ({ page }) => {
    await page.goto("/");

    const firstLoop = page.getByRole("switch").first();
    await expect(firstLoop).toBeChecked();
    await firstLoop.click();
    await expect(firstLoop).not.toBeChecked();

    await page.getByRole("link", { name: "GitHub settings" }).click();
    await expect(
      page.getByRole("heading", { name: "Connection, label mapping, and dev fixtures" }),
    ).toBeVisible();
    await expect(page.getByText("GitHub app connected")).toBeVisible();
  });

  test("has no critical a11y violations on primary portal surfaces", async ({ page }) => {
    await page.goto("/");

    const dashboardResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(dashboardResults.violations).toEqual([]);

    await page.goto("/github");

    const githubSettingsResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(githubSettingsResults.violations).toEqual([]);
  });
});
