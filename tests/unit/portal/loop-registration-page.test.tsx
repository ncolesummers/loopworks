import { cleanup, render, screen } from "@testing-library/react";

import { LoopRegistrationPageContent } from "@/app/(portal)/loops/register/page";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@/lib/observability/logger", () => ({
  createRequestLogger: () => ({ warn }),
}));

// The page renders a client component that refreshes the server read after registering; jsdom has
// no mounted app router.
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("loop registration page", () => {
  it("renders the form for an operator with tracked repositories", async () => {
    render(
      await LoopRegistrationPageContent({
        readRegistration: async () => ({
          repositories: [
            {
              defaultBranch: "main",
              fullName: "loopworks-org/portal",
              id: "11111111-1111-4111-8111-111111111111",
              name: "portal",
              owner: "loopworks-org",
            },
          ],
          status: "ready",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Register a loop" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /loopworks-org\/portal/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register loop" })).toBeTruthy();
  });

  it("routes an operator with no tracked repositories back to selection", async () => {
    render(
      await LoopRegistrationPageContent({
        readRegistration: async () => ({ status: "no-tracked-repositories" }),
      }),
    );

    expect(screen.getByRole("link", { name: "Select repositories" }).getAttribute("href")).toBe(
      "/settings/repositories",
    );
  });

  it("degrades to an error state rather than blanking the page when the read throws", async () => {
    render(
      await LoopRegistrationPageContent({
        readRegistration: async () => {
          throw new Error("postgres://user:secret@host");
        },
      }),
    );

    // The surrounding surface and its route back must survive a failed read.
    expect(screen.getByRole("heading", { name: "Register a loop" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to loops" })).toBeTruthy();
    expect(screen.getByText("Loop registration unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret");
    expect(warn).toHaveBeenCalledWith(
      { reason: "unexpected_error" },
      "loop_registration_read_failed",
    );
  });

  it("serves the fixture snapshot only under the explicit non-production fixture gate", async () => {
    const readRegistration = vi.fn();

    render(
      await LoopRegistrationPageContent({
        env: { LOOPWORKS_PORTAL_DATA_MODE: "fixtures", NODE_ENV: "development" },
        readRegistration,
      }),
    );

    expect(readRegistration).not.toHaveBeenCalled();
    expect(screen.getByText(/fixture data, so registration is disabled/i)).toBeTruthy();
  });

  it("never serves fixtures in production, even when the data mode asks for them", async () => {
    render(
      await LoopRegistrationPageContent({
        env: { LOOPWORKS_PORTAL_DATA_MODE: "fixtures", NODE_ENV: "production" },
        readRegistration: async () => ({ status: "no-tracked-repositories" }),
      }),
    );

    expect(screen.queryByText(/fixture data/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Select repositories" })).toBeTruthy();
  });
});
