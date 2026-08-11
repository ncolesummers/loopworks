import { expect, test } from "@playwright/test";

test.describe("Loopworks auth guard", () => {
  test("redirects protected routes to sign-in when fixture bypass is disabled", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({
      "x-loopworks-disable-auth-bypass": "true",
    });
    await page.goto("/");

    // #214 changed where the guard sends an unauthenticated request, not whether it redirects.
    await expect.poll(() => new URL(page.url()).pathname).toBe("/sign-in");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  });

  /**
   * Persona P06 (#214). The guard's own decision is covered above; this covers what the operator
   * it turns away actually reads. Bypass is disabled by header, so the surface is reached the way
   * a real unauthenticated visitor reaches it rather than by navigating to it directly - a
   * `page.goto` of the sign-in path would prove the route renders, not that the guard routes to
   * it.
   */
  test("orients an unauthenticated operator before handing them to GitHub", async ({ page }) => {
    await page.setExtraHTTPHeaders({
      "x-loopworks-disable-auth-bypass": "true",
    });
    await page.goto("/loops");

    // Anchored on the pathname: a regex for the sign-in path also matches the framework default.
    await expect.poll(() => new URL(page.url()).pathname).toBe("/sign-in");
    // The protected surface never rendered.
    await expect(page.getByRole("heading", { name: "Registered loops" })).toHaveCount(0);

    await expect(
      page.getByRole("heading", { level: 1, name: "Sign in to Loopworks" }),
    ).toBeVisible();
    await expect(page.getByText(/software delivery loops/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Why Loopworks uses GitHub" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Who can sign in" })).toBeVisible();
    await expect(page.getByRole("list").getByRole("listitem")).toContainText([
      "Install the GitHub App",
      "Select repositories",
      "Register your first loop",
    ]);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  });
});
