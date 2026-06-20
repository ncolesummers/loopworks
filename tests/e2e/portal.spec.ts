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

  // Persona P04: an operator switches light/dark from the shell and it persists.
  test("operator can switch light/dark from the shell and the choice persists", async ({
    page,
  }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: "Toggle theme" });
    await expect(toggle).toBeEnabled();

    const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
    const before = await isDark();

    await toggle.click();
    await expect.poll(isDark).toBe(!before);

    // Preference persists across a reload (next-themes localStorage).
    await page.reload();
    await expect.poll(isDark).toBe(!before);
  });

  // Design-system gate: axe (including color-contrast) must pass on the primary
  // surfaces in BOTH light and dark. The monochrome base + soft status fills are
  // the contrast risk, so contrast is intentionally NOT disabled here.
  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`color scheme: ${colorScheme}`, () => {
      test.use({ colorScheme });

      test("has no a11y violations (incl. contrast) on primary portal surfaces", async ({
        page,
      }) => {
        for (const path of ["/", "/github"]) {
          await page.goto(path);
          // Full default axe rule set (wcag2/wcag21/best-practice) WITH
          // color-contrast — only the prior contrast suppression is removed.
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations, `${colorScheme} ${path}`).toEqual([]);
        }
      });
    });
  }
});
