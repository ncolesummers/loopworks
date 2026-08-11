import { cleanup, render, screen, within } from "@testing-library/react";

import { SignInView } from "@/components/auth/sign-in-view";
import { signInErrorNotices, signInFallbackNotice } from "@/lib/auth/sign-in-errors";

afterEach(cleanup);

const noopAction = async () => {};

function surface() {
  return screen.getByRole("region", { name: "Sign in to Loopworks" });
}

describe("sign-in orientation", () => {
  it("names the product, why GitHub, who may sign in, and what comes next", () => {
    render(<SignInView action={noopAction} callbackUrl="/" />);

    expect(screen.getByRole("heading", { level: 1, name: "Sign in to Loopworks" })).toBeDefined();
    expect(screen.getByText(/software delivery loops/i)).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 2, name: "Why Loopworks uses GitHub" }),
    ).toBeDefined();
    expect(screen.getByRole("heading", { level: 2, name: "Who can sign in" })).toBeDefined();

    const steps = screen.getByRole("list");
    expect(steps.getAttribute("aria-labelledby")).toBeNull();
    const items = within(steps).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Install the GitHub App");
    expect(items[1]?.textContent).toContain("Select repositories");
    expect(items[2]?.textContent).toContain("Register your first loop");
  });

  it("offers exactly one primary action, and submits it", () => {
    render(<SignInView action={noopAction} callbackUrl="/" />);

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);

    const action = screen.getByRole("button", { name: "Continue with GitHub" });
    // `Button` defaults to type="button", which silently does not submit inside a form.
    expect(action.getAttribute("type")).toBe("submit");
  });

  it("states the access expectation without offering signup", () => {
    render(<SignInView action={noopAction} callbackUrl="/" />);

    const access = screen.getByRole("region", { name: "Who can sign in" });
    expect(access.textContent?.toLowerCase()).toContain("approved");
    expect(access.textContent?.toLowerCase()).not.toContain("sign up");
    expect(access.textContent?.toLowerCase()).not.toContain("request access");
  });

  it("links nowhere, because no public docs or landing route exists yet", () => {
    render(<SignInView action={noopAction} callbackUrl="/" />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("carries the sanitized callback path in the form rather than the raw parameter", () => {
    const { container } = render(<SignInView action={noopAction} callbackUrl="/loops" />);

    const field = container.querySelector('input[name="callbackUrl"]');
    expect(field?.getAttribute("type")).toBe("hidden");
    expect(field?.getAttribute("value")).toBe("/loops");
  });
});

describe("sign-in failure states", () => {
  it("renders the mapped notice for a denied account", () => {
    render(
      <SignInView action={noopAction} callbackUrl="/" notice={signInErrorNotices.AccessDenied} />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain(signInErrorNotices.AccessDenied.title);
    expect(status.textContent).toContain(signInErrorNotices.AccessDenied.detail);
    expect(status.textContent).toContain(signInErrorNotices.AccessDenied.nextStep);
  });

  it("keeps the retry path reachable in every failure state", () => {
    for (const notice of [...Object.values(signInErrorNotices), signInFallbackNotice]) {
      render(<SignInView action={noopAction} callbackUrl="/" notice={notice} />);
      expect(
        screen.getByRole("button", { name: "Continue with GitHub" }),
        notice.title,
      ).toBeDefined();
      cleanup();
    }
  });

  /**
   * The `error` parameter is attacker-controlled, so the surface must render the mapped copy and
   * nothing derived from the value itself.
   */
  it("never renders a raw error code or injected markup", () => {
    render(<SignInView action={noopAction} callbackUrl="/" notice={signInFallbackNotice} />);

    const text = surface().textContent ?? "";
    expect(text).not.toContain("AccessDenied");
    expect(text).not.toContain("<img");
    expect(text).not.toContain("Configuration");
  });

  it("keeps the notice slot contract across the default and every failure state", () => {
    const slotClassNames: string[] = [];

    for (const notice of [undefined, ...Object.values(signInErrorNotices), signInFallbackNotice]) {
      const { container } = render(
        <SignInView action={noopAction} callbackUrl="/" notice={notice} />,
      );
      const slot = container.querySelector("[data-sign-in-notice]");
      expect(slot).not.toBeNull();
      slotClassNames.push(slot?.className ?? "");
      cleanup();
    }

    expect(new Set(slotClassNames).size).toBe(1);
    expect(slotClassNames[0]).toContain("min-h-[12rem]");
  });

  /**
   * The notice slot is present whether or not there is a notice, so arriving at an error state
   * does not shift the card's contents down the page.
   */
  it("reserves the notice slot even with no notice to show", () => {
    const { container } = render(<SignInView action={noopAction} callbackUrl="/" />);

    const slot = container.querySelector("[data-sign-in-notice]");
    expect(slot).not.toBeNull();
    expect(slot?.className).toContain("min-h-[12rem]");
    expect(screen.queryByRole("status")?.textContent ?? "").toBe("");
  });
});
