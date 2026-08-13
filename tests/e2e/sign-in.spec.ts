import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { captureBrowserErrors } from "../helpers/browser-errors";

/**
 * The sign-in surface (#214), personas P06 and S07.
 *
 * `tests/e2e/auth-guard.spec.ts` owns the one assertion that must arrive through the guard: that
 * an unauthenticated protected-route request lands here at all. Everything below is about the
 * surface itself, so it navigates directly and covers the states the guard cannot produce on
 * demand - a denial, a provider failure, and a junk error parameter.
 */

const signInPath = "/sign-in";
const primaryAction = "Continue with GitHub";
const browserErrors = new WeakMap<object, string[]>();

test.beforeEach(({ page }) => {
  browserErrors.set(page, captureBrowserErrors(page));
});

test.afterEach(({ page }) => {
  expect(browserErrors.get(page), "sign-in emitted a browser runtime error").toEqual([]);
});

/**
 * What the operator actually reads. `textContent` would also return the contents of `<script>`
 * elements, and Next serializes the request URL - including its `error` parameter - into the RSC
 * payload, so asserting over it would fail on text no human ever sees.
 */
async function renderedText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test.describe("Loopworks sign-in surface", () => {
  test("keeps one primary action and links nowhere while public docs do not exist", async ({
    page,
  }) => {
    await page.goto(signInPath);

    await expect(page.getByRole("button", { name: primaryAction })).toBeVisible();
    // #103, #104, #107, and #108 are open, so any outbound link would be a dead one.
    await expect(page.locator('a[href^="http"]')).toHaveCount(0);
    await expect(page.locator("a")).toHaveCount(0);
  });

  test("states the access expectation without offering signup", async ({ page }) => {
    await page.goto(signInPath);

    const access = page.getByRole("region", { name: "Who can sign in" });
    await expect(access).toContainText("approved");
    await expect(access.getByText("Approved accounts only")).toBeVisible();
    await expect(page.getByText(/sign up/i)).toHaveCount(0);
    await expect(page.getByText(/request access/i)).toHaveCount(0);
  });

  test("renders a denied sign-in as an outcome with a human next step", async ({ page }) => {
    await page.goto(`${signInPath}?error=AccessDenied`);

    const notice = page.getByRole("status");
    await expect(notice).toContainText("This GitHub account is not approved yet");
    await expect(notice).toContainText("No session was created.");
    await expect(notice).toContainText("Ask the workspace operator");
    // The retry path stays available: the operator may simply be on the wrong account.
    await expect(page.getByRole("button", { name: primaryAction })).toBeEnabled();
  });

  test("never shows a raw error parameter, however it arrives", async ({ page }) => {
    await page.goto(`${signInPath}?error=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E`);

    const notice = page.getByRole("status");
    await expect(notice).toContainText("Sign-in did not complete");

    // `innerText`, not `textContent`: the latter also returns the contents of `<script>` elements,
    // and Next serializes the request URL into the RSC payload rather than visible page copy.
    const rendered = await renderedText(page);
    expect(rendered).not.toContain("onerror");
    expect(rendered).not.toContain("<img");
  });

  test("discloses no allowlist internals or auth material in any failure state", async ({
    page,
  }) => {
    const codes = [
      "AccessDenied",
      "Configuration",
      "OAuthCallbackError",
      "OAuthAccountNotLinked",
      "MissingCSRF",
      "definitely-not-a-code",
    ];
    const forbidden = ["allowlist", "loopworks_allowed", "read:org", "read:user", "token"];

    for (const code of codes) {
      await page.goto(`${signInPath}?error=${code}`);
      const rendered = (await renderedText(page)).toLowerCase();

      for (const term of forbidden) {
        expect(rendered, `${code} leaked ${term}`).not.toContain(term);
      }
      // The code itself is framework vocabulary, so it is mapped rather than echoed.
      expect(rendered, `${code} was echoed verbatim`).not.toContain(code.toLowerCase());
    }
  });

  test("holds the surface height steady between the default and a failure state", async ({
    page,
  }) => {
    for (const viewport of [
      { name: "mobile", width: 390, height: 844 },
      { name: "desktop", width: 1440, height: 960 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(signInPath);
      const clean = await page.getByRole("region", { name: "Sign in to Loopworks" }).boundingBox();

      await page.goto(`${signInPath}?error=AccessDenied`);
      const failed = await page.getByRole("region", { name: "Sign in to Loopworks" }).boundingBox();

      expect(clean, `${viewport.name} default surface`).not.toBeNull();
      expect(failed, `${viewport.name} error surface`).not.toBeNull();
      expect(clean?.width, `${viewport.name} width`).toBe(failed?.width);
      // The reserved notice slot keeps the state change below one line of copy at every target width.
      expect(
        Math.abs((failed?.height ?? 0) - (clean?.height ?? 0)),
        `${viewport.name} layout shift`,
      ).toBeLessThan(40);
    }
  });

  test("reaches the primary action by keyboard with a visible focus ring", async ({ page }) => {
    await page.goto(signInPath);

    const action = page.getByRole("button", { name: primaryAction });
    // The mode toggle is the first focusable control; walking with Tab proves the action is
    // reachable by keyboard rather than merely focusable through Playwright's DOM API.
    for (
      let tab = 0;
      tab < 3 && !(await action.evaluate((node) => node === document.activeElement));
      tab++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(action).toBeFocused();

    const baseline = await action.evaluate((node) => {
      node.blur();
      return getComputedStyle(node).boxShadow;
    });
    await action.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    const { ring, ringColor } = await action.evaluate((node) => {
      const probe = document.createElement("span");
      probe.style.color = `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--ring")})`;
      document.body.append(probe);
      const result = {
        ring: getComputedStyle(node).boxShadow,
        ringColor: getComputedStyle(probe).color,
      };
      probe.remove();
      return result;
    });
    expect(ring, "keyboard focus must add a ring beyond the ordinary button shadow").not.toBe(
      baseline,
    );
    expect(ring).toContain(ringColor);
  });

  /**
   * Proves the whole server-action mechanism - the `"use server"` module, the cookie writes, and
   * the external redirect - without a network request, and proves the sanitizer end to end: the
   * off-origin `callbackUrl` never becomes the post-login target.
   */
  test("hands the operator to GitHub authorization and never forwards an off-origin target", async ({
    page,
  }) => {
    await page.route("https://github.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<title>github stub</title>",
      }),
    );

    await page.goto(`${signInPath}?callbackUrl=https%3A%2F%2Fgithub.com%2Floopworks-off-origin`);
    await page.getByRole("button", { name: primaryAction }).click();

    await page.waitForURL(
      (url) => url.hostname === "github.com" && url.pathname === "/login/oauth/authorize",
    );
    const handoff = new URL(page.url());
    expect(handoff.hostname).toBe("github.com");
    expect(handoff.pathname).toBe("/login/oauth/authorize");
    expect(handoff.searchParams.get("scope")).toBe("read:user user:email read:org");

    /*
      The post-login target is not in the authorize URL - it is in the `authjs.callback-url`
      cookie Auth.js writes during the handshake. Asserting the URL alone would pass even if the
      sanitizer were replaced by the identity function, so the cookie is what gets checked.
    */
    const cookies = await page.context().cookies();
    const callbackCookie = cookies.find((cookie) => cookie.name.endsWith("authjs.callback-url"));
    expect(callbackCookie, "Auth.js did not write a callback-url cookie").toBeDefined();
    const callbackUrl = decodeURIComponent(callbackCookie?.value ?? "");
    const callbackTarget = new URL(callbackUrl);
    // The sanitizer intentionally preserves the path while discarding the submitted origin.
    expect(callbackTarget.hostname).not.toBe("github.com");
    expect(callbackTarget.pathname).toBe("/loopworks-off-origin");
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 960 },
  ] as const) {
    test(`stays inside the ${viewport.name} viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`${signInPath}?error=AccessDenied`);

      const action = page.getByRole("button", { name: primaryAction });
      await expect(action).toBeVisible();
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeInViewport();
      const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `${viewport.name} horizontal overflow`).toBeLessThanOrEqual(
        viewportWidth + 1,
      );
    });
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test.describe(`color scheme: ${colorScheme}`, () => {
      test.use({ colorScheme });

      test("has no accessibility violations in the default or denied state", async ({ page }) => {
        for (const path of [signInPath, `${signInPath}?error=AccessDenied`]) {
          await page.goto(path);
          const results = await new AxeBuilder({ page }).analyze();
          expect(results.violations, `${colorScheme} ${path}`).toEqual([]);
        }
      });
    });
  }
});
