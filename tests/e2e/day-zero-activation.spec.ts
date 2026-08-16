import { execFileSync } from "node:child_process";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * Persona P05/M04/M05: the day-zero operator walk (#128).
 *
 * The database starts empty and advances one stage at a time, so every assertion below is made
 * against a first-run state that the populated demo lane can never reach.
 * GitHub itself is the one boundary this lane cannot cross - Octokit has no base-URL seam and no
 * test may reach the network - so installation and repository access arrive as explicit fixture
 * rows, and everything the product owns is driven through its real surfaces.
 */

// The stages mutate one shared database, so the file must not interleave with itself.
test.describe.configure({ mode: "serial" });

type DayZeroStage = "installation" | "repository" | "reset";

function applyStage(stage: DayZeroStage): void {
  execFileSync("bun", ["run", "scripts/seed-day-zero.ts", stage], {
    encoding: "utf8",
    env: process.env,
    stdio: "pipe",
  });
}

/**
 * The AC is that the operator is never shown an empty state naming an action they cannot take, so
 * this checks the affordances actually rendered rather than the inventory's declarations. An
 * internal page link must resolve; a route handler under `/api/` redirects off-site, so it is
 * checked for being one of the install routes the app serves rather than followed.
 */
async function expectNoDeadEndEmptyStates(page: Page, label: string): Promise<void> {
  const emptyStates = page.locator("[data-empty-state]");
  const count = await emptyStates.count();

  for (let index = 0; index < count; index += 1) {
    const emptyState = emptyStates.nth(index);
    const id = await emptyState.getAttribute("data-empty-state");
    const links = emptyState.locator("a[href]");
    const linkCount = await links.count();

    for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
      const href = await links.nth(linkIndex).getAttribute("href");
      expect(href, `${label}: ${id} rendered an action with no href`).toBeTruthy();
      if (href === null) continue;

      if (href.startsWith("/api/")) {
        expect(
          ["/api/github/install", "/api/github/install/reconcile"],
          `${label}: ${id} routes to an unknown route handler`,
        ).toContain(href);
        continue;
      }

      if (href.startsWith("/")) {
        const response = await page.request.get(href);
        expect(
          response.status(),
          `${label}: ${id} routes to ${href}, which the app does not serve`,
        ).toBeLessThan(400);
      }
    }
  }
}

/** Both themes at every step, per the issue's a11y acceptance criterion. */
async function expectAxeCleanInBothThemes(page: Page, label: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${label} (${colorScheme})`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function expectStepIsClean(page: Page, label: string): Promise<void> {
  await expectNoDeadEndEmptyStates(page, label);
  await expectAxeCleanInBothThemes(page, label);
}

test.beforeAll(() => {
  applyStage("reset");
});

test.afterAll(() => {
  applyStage("reset");
});

test("day-zero operator walks from an empty database to a registered loop", async ({ page }) => {
  // P05, stage one: no installation. Every surface must name the installation step.
  await page.goto("/");
  await expect(
    page.locator('[data-empty-state="onboarding-no-installation"]').first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect the GitHub App" }).first()).toHaveAttribute(
    "href",
    "/api/github/install",
  );
  // GitHub dead-ends the install link for an account that already has the App (#151).
  await expect(
    page.getByRole("link", { name: "Find existing installation" }).first(),
  ).toHaveAttribute("href", "/api/github/install/reconcile");
  await expectStepIsClean(page, "no-installation /");

  await page.goto("/catalog");
  await expect(
    page.locator('[data-empty-state="onboarding-no-installation"]').first(),
  ).toBeVisible();
  await expectStepIsClean(page, "no-installation /catalog");

  await page.goto("/loops");
  await expect(
    page.locator('[data-empty-state="onboarding-no-installation"]').first(),
  ).toBeVisible();
  await expectStepIsClean(page, "no-installation /loops");

  // M04: a cancelled install and an install GitHub reports nothing for must read differently, and
  // neither may leave the operator without the reconciliation route.
  await page.goto("/settings?github=cancelled");
  await expect(
    page.getByText("GitHub App installation was cancelled. No connection was saved."),
  ).toBeVisible();
  await expect(page.locator('[data-empty-state="github-settings-no-installation"]')).toBeVisible();
  await expectStepIsClean(page, "cancelled install /settings");

  await page.goto("/settings?github=no-installation-found");
  await expect(page.getByText(/No GitHub App installation was visible/)).toBeVisible();
  await expect(page.getByText("GitHub App installation was cancelled.")).toHaveCount(0);
  await expectStepIsClean(page, "no-installation-found /settings");

  // M04, stage two: the installation exists and grants access to no repository yet.
  applyStage("installation");

  await page.goto("/");
  await expect(
    page.locator('[data-empty-state="onboarding-no-repositories"]').first(),
  ).toBeVisible();
  await expect(page.locator('[data-empty-state="onboarding-no-installation"]')).toHaveCount(0);
  await expectStepIsClean(page, "no-repositories /");

  await page.getByRole("link", { name: "Select repositories" }).first().click();
  await expect(page).toHaveURL(/\/settings\/repositories$/);
  // The list itself comes from GitHub, which this lane stubs at the boundary. What must hold is
  // ADR 0019's distinction: an unreachable source renders as a failure, never as an empty state
  // claiming a next step the operator cannot take.
  const selectionSurface = page.locator('section[aria-label="Repository selection"]');
  await expect(selectionSurface).toBeVisible();
  await expect(selectionSurface).not.toHaveAttribute("data-empty-state", /.+/);
  await expectStepIsClean(page, "no-repositories /settings/repositories");

  // M05, stage three: a tracked repository exists, so registration is the next step.
  applyStage("repository");

  await page.goto("/");
  await expect(page.locator('[data-empty-state="onboarding-no-loops"]').first()).toBeVisible();
  await expectStepIsClean(page, "no-loops /");

  await page.goto("/loops");
  await expect(page.locator('[data-empty-state="onboarding-no-loops"]').first()).toBeVisible();
  await page.getByRole("link", { name: "Register a loop" }).first().click();
  await expect(page).toHaveURL(/\/loops\/register$/);
  await expect(page.getByText("ncolesummers/loopworks-day-zero").first()).toBeVisible();
  await expectStepIsClean(page, "no-loops /loops/register");

  // The registration itself is the product's own path: the form ships valid defaults.
  await page.getByRole("button", { name: "Register loop" }).click();
  await expect(page.getByText(/It now appears in the loop registry\./)).toBeVisible();

  // M05: the registry reflects the registered loop, and the operator is activated, not onboarding.
  await page.goto("/loops");
  await expect(page.locator('[data-empty-state="onboarding-no-loops"]')).toHaveCount(0);
  const registry = page.getByRole("region", { name: "Registered loops" });
  await expect(registry.getByText("ncolesummers/loopworks-day-zero").first()).toBeVisible();
  await expect(registry.getByText("1 enabled")).toBeVisible();
  await expectStepIsClean(page, "activated /loops");

  await page.goto("/");
  await expect(page.locator('[data-empty-state^="onboarding-"]')).toHaveCount(0);
  await expectStepIsClean(page, "activated /");
});
