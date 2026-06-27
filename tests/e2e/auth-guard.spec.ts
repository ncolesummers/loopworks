import { expect, test } from "@playwright/test";

test.describe("Loopworks auth guard", () => {
  test("redirects protected routes to sign-in when fixture bypass is disabled", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({
      "x-loopworks-disable-auth-bypass": "true",
    });
    await page.goto("/");

    await expect(page).toHaveURL(/\/api\/auth\/signin/);
    await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toBeVisible();
  });
});
