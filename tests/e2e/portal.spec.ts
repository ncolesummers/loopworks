import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const portalRoutes = [
  {
    path: "/",
    nav: "Dashboard",
    heading: "Agentic delivery loops, repo health, and deployment visibility",
  },
  { path: "/catalog", nav: "Catalog", heading: "Repo catalog" },
  { path: "/loops", nav: "Loops", heading: "Loop registry" },
  { path: "/runs", nav: "Runs", heading: "Run timeline and artifacts" },
  { path: "/approvals", nav: "Approvals", heading: "Approval gate" },
  {
    path: "/deployments",
    nav: "Deployments",
    heading: "Vercel deployments and previews",
  },
  {
    path: "/settings",
    nav: "Settings",
    heading: "Connection, label mapping, and dev fixtures",
  },
] as const;

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

  test("renders reusable M1 component contracts on the dashboard", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("switch", { name: "Intake and triage" })).toBeChecked();
    await expect(page.getByText("Needs Approval").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Validation results" })).toBeVisible();
    await expect(page.getByText("Typecheck", { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Typecheck evidence" })).toHaveAttribute(
      "href",
      "https://github.com/ncolesummers/loopworks/actions",
    );
    await expect(page.getByRole("link", { name: "Preview URL" })).toBeVisible();
    await expect(page.getByText("Ready", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Preview", { exact: true }).first()).toBeVisible();
  });

  test("lets the operator toggle a loop and open settings", async ({ page }) => {
    await page.goto("/");

    const firstLoop = page.getByRole("switch").first();
    await expect(firstLoop).toBeChecked();
    await firstLoop.click();
    await expect(firstLoop).not.toBeChecked();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Connection, label mapping, and dev fixtures" }),
    ).toBeVisible();
    await expect(page.getByText("GitHub app connected")).toBeVisible();
  });

  // Persona P01: a signed-in operator can move across each protected MVP slice.
  test("navigates between protected MVP slices with a shared session surface", async ({ page }) => {
    await page.goto("/");

    for (const route of portalRoutes) {
      await page.getByRole("link", { name: route.nav, exact: true }).click();
      await expect(page).toHaveURL(route.path);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
      await expect(page.getByText("Fixture session")).toBeVisible();
      await expect(page.getByText("Operator workspace", { exact: true })).toBeVisible();
    }
  });

  // Persona M01/R01: maintainers and reviewers can inspect repo and Vercel evidence.
  test("catalog and deployment workflows expose persona-critical metadata", async ({ page }) => {
    await page.goto("/catalog");

    await expect(page.getByRole("heading", { name: "Repo catalog" })).toBeVisible();
    const loopworksRow = page.getByRole("row", { name: /ncolesummers\/loopworks-web/ });
    await expect(
      loopworksRow.getByRole("link", { name: "ncolesummers/loopworks-web" }),
    ).toHaveAttribute("href", "https://github.com/ncolesummers/loopworks-web");
    await expect(loopworksRow.getByText("Next.js")).toBeVisible();
    await expect(loopworksRow.getByText("main", { exact: true })).toBeVisible();
    await expect(loopworksRow.getByText("bun run validate")).toBeVisible();
    await expect(loopworksRow.getByText("Intake and triage")).toBeVisible();
    await expect(loopworksRow.getByText("Typecheck")).toBeVisible();
    await expect(loopworksRow.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://github.com/ncolesummers/loopworks/tree/main/docs",
    );
    await expect(loopworksRow.getByRole("link", { name: "Observability" })).toBeVisible();
    await expect(loopworksRow.getByRole("link", { name: "Design system" })).toBeVisible();
    await expect(
      loopworksRow.getByRole("link", { name: "Vercel project prj_loopworks" }),
    ).toBeVisible();

    await expect(
      page.getByRole("row", { name: /ncolesummers\/delivery-ops/ }).getByText("Blocked", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("row", { name: /ncolesummers\/integration-playground/ })
        .getByText("Disconnected"),
    ).toBeVisible();

    await page.getByLabel("Search repositories").fill("factory");
    await expect(page.getByText("ncolesummers/factory-core")).toBeVisible();
    await expect(page.getByText("ncolesummers/loopworks-web")).toHaveCount(0);

    await page.getByLabel("Search repositories").fill("");
    await page.getByLabel("Filter by health").selectOption("blocked");
    await expect(page.getByText("ncolesummers/delivery-ops")).toBeVisible();
    await expect(page.getByText("ncolesummers/factory-core")).toHaveCount(0);

    await page.getByLabel("Search repositories").fill("missing-repo");
    await expect(page.getByText("No repositories match the current filters")).toBeVisible();

    await page.getByRole("link", { name: "Deployments", exact: true }).click();
    await expect(page).toHaveURL("/deployments");
    await expect(page.getByText("preview/portal-shell")).toBeVisible();
    await expect(page.getByText("Playwright passed")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open preview/portal-shell" })).toBeVisible();
  });

  test("deployment overview shows Vercel states, metadata, and safe links", async ({ page }) => {
    await page.goto("/deployments");

    const overview = page.locator("#deployments");
    await expect(
      page.getByRole("heading", { name: "Vercel deployments and previews" }),
    ).toBeVisible();
    await expect(overview.getByText("Production", { exact: true })).toBeVisible();
    await expect(overview.getByText("Preview", { exact: true }).first()).toBeVisible();
    await expect(overview.getByText("Ready", { exact: true }).first()).toBeVisible();
    await expect(overview.getByText("Building", { exact: true })).toBeVisible();
    await expect(overview.getByText("Errored", { exact: true })).toBeVisible();
    await expect(overview.getByText("main", { exact: true })).toBeVisible();
    await expect(overview.getByText("codex/9-vercel-deploy", { exact: true })).toBeVisible();
    await expect(overview.getByText("badc0de", { exact: true })).toBeVisible();
    await expect(overview.getByText("Build failed", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open production/main" })).toHaveAttribute(
      "href",
      "https://loopworks.vercel.app/",
    );
    await expect(
      page.getByRole("link", { name: "Open Vercel details for production/main" }),
    ).toHaveAttribute("href", "https://vercel.com/ncolesummers/loopworks/dpl_prod");
    await expect(page.getByRole("button", { name: "Open preview/building" })).toBeDisabled();
    await expect(overview.getByText("No preview URL yet")).toHaveCount(2);
  });

  // Persona M02: pausing a loop records a skipped reason instead of silently triggering.
  test("pausing a loop records the disabled trigger reason", async ({ page }) => {
    await page.goto("/loops");

    const intakeLoop = page.getByRole("switch", { name: "Intake and triage" });
    await expect(intakeLoop).toBeChecked();
    await intakeLoop.click();

    await expect(intakeLoop).not.toBeChecked();
    await expect(page.getByText("Skipped: loop_disabled")).toBeVisible();
  });

  // Persona A01/A03/R01: deterministic evidence is visible before PR/review stages.
  test("run timeline shows ordered stages and validation evidence before review", async ({
    page,
  }) => {
    await page.goto("/runs");

    await expect(page.getByText("Waiting approval").first()).toBeVisible();
    await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Blocked on missing Vercel scope grant.")).toBeVisible();
    await expect(page.getByRole("button", { name: /ncolesummers\/factory-core/ })).toBeVisible();

    const stages = [
      "Planning",
      "Test writing",
      "Development",
      "Validation",
      "Code review",
      "Commit",
      "PR",
      "Done",
    ];
    let previousY = -1;
    for (const stage of stages) {
      const item = page.getByText(stage, { exact: true }).last();
      await expect(item).toBeVisible();
      const box = await item.boundingBox();
      expect(box, stage).not.toBeNull();
      if (box) {
        expect(box.y, `${stage} should appear after prior stage`).toBeGreaterThan(previousY);
        previousY = box.y;
      }
    }

    const validationBox = await page.getByText("Validation", { exact: true }).last().boundingBox();
    const codeReviewBox = await page.getByText("Code review", { exact: true }).last().boundingBox();
    expect(validationBox?.y ?? 0).toBeLessThan(codeReviewBox?.y ?? 0);
    await expect(page.getByRole("link", { name: "Validation report" })).toBeVisible();

    await page.getByRole("button", { name: /ncolesummers\/factory-core/ }).click();
    await expect(page.getByRole("heading", { name: "Run detail" })).toBeVisible();
    await expect(page.getByText("deploy-preview")).toBeVisible();
    await expect(page.getByText("morgan-dev")).toBeVisible();
  });

  // Persona A02: approval gates preserve actor/evidence context through the request flow.
  test("approval request flow keeps reviewer evidence visible", async ({ page }) => {
    await page.goto("/approvals");

    await expect(page.getByText("Owner Priya")).toBeVisible();
    await expect(page.getByText("Write paths require explicit approval")).toBeVisible();

    await page.getByRole("button", { name: "Request approval" }).click();
    await expect(page.getByRole("dialog", { name: "Request security approval" })).toBeVisible();
    await expect(page.getByLabel("Reviewer notes")).toContainText(
      "Verified GitHub scoping, preview visibility, and redaction rules",
    );
    await page.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByRole("dialog", { name: "Request security approval" })).toBeHidden();
  });

  test("keeps the legacy GitHub settings route as a settings alias", async ({ page }) => {
    await page.goto("/github");

    await expect(page).toHaveURL("/settings");
    await expect(
      page.getByRole("heading", { name: "Connection, label mapping, and dev fixtures" }),
    ).toBeVisible();
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "laptop", width: 1280, height: 832 },
    { name: "desktop", width: 1440, height: 960 },
  ] as const) {
    test(`keeps shell navigation readable at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const navBoxes = [];
      for (const route of portalRoutes) {
        const link = page.getByRole("link", { name: route.nav, exact: true });
        await expect(link).toBeVisible();
        const box = await link.boundingBox();
        expect(box, `${viewport.name} ${route.nav} link`).not.toBeNull();
        navBoxes.push(box);
      }

      for (const [index, box] of navBoxes.entries()) {
        const nextBox = navBoxes[index + 1];
        if (box && nextBox) {
          expect(
            box.y + box.height <= nextBox.y + 1,
            `${viewport.name} nav links should not overlap vertically`,
          ).toBe(true);
        }
      }

      await expect(
        page.getByRole("heading", {
          name: "Agentic delivery loops, repo health, and deployment visibility",
        }),
      ).toBeVisible();
    });
  }

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
        for (const { path } of portalRoutes) {
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
