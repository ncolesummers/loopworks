import { auth } from "@/auth";
import { POST as postApprovalTransition } from "@/app/api/approvals/transition/route";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const authMock = vi.mocked(auth as unknown as () => Promise<Session | null>);

describe("approval transition API", () => {
  afterEach(() => {
    authMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("attributes approval transitions to the authenticated GitHub login", async () => {
    vi.stubEnv("LOOPWORKS_ALLOWED_GITHUB_USERS", "ncolesummers");
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
        githubLogin: "ncolesummers",
      },
    });

    const response = await postApprovalTransition(
      new Request("https://loopworks.local/api/approvals/transition", {
        method: "POST",
        body: JSON.stringify({
          currentStatus: "requested",
          action: "approve",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      transition: {
        from: "requested",
        to: "approved",
        action: "approve",
        actorId: "ncolesummers",
      },
    });
  });

  it("rejects real authenticated sessions that are missing persisted GitHub login", async () => {
    authMock.mockResolvedValue({
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        name: "Nathan Summers",
        email: "nathan@example.com",
      },
    });

    const response = await postApprovalTransition(
      new Request("https://loopworks.local/api/approvals/transition", {
        method: "POST",
        body: JSON.stringify({
          currentStatus: "requested",
          action: "approve",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub identity is not authorized.",
      reason: "missing_github_login",
    });
  });
});
