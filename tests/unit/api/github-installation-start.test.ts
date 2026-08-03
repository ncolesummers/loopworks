/** @vitest-environment node */

import { handleGithubInstallationStart } from "@/app/api/github/install/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GitHub App installation entry route", () => {
  it("requires the existing API session and redirects an operator to GitHub", async () => {
    const start = vi.fn(async () => ({
      location: "https://github.com/apps/loopworks-app/installations/new?state=opaque",
    }));
    const response = await handleGithubInstallationStart(
      new Request("https://loopworks.local/api/github/install"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        start,
      },
    );

    expect(start).toHaveBeenCalledWith({ actorId: "ncolesummers" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/loopworks-app/installations/new?state=opaque",
    );
  });
});
