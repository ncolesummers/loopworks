import { authorizeGithubSession } from "@/lib/auth/session-policy";

const baseConfig = {
  bypass: false,
  allowedGithubUsers: ["ncolesummers"],
  allowedGithubOrgs: [],
};

describe("auth session policy", () => {
  it("allows an active GitHub session only while the login remains allowlisted", async () => {
    await expect(
      authorizeGithubSession({
        session: {
          expires: "2026-06-27T00:00:00.000Z",
          user: {
            githubLogin: "ncolesummers",
          },
        },
        config: baseConfig,
      }),
    ).resolves.toMatchObject({
      authorized: true,
      reason: "github_user",
    });

    await expect(
      authorizeGithubSession({
        session: {
          expires: "2026-06-27T00:00:00.000Z",
          user: {
            githubLogin: "former-operator",
          },
        },
        config: baseConfig,
      }),
    ).resolves.toMatchObject({
      authorized: false,
      reason: "not_allowlisted",
    });
  });

  it("revalidates organization allowlist sessions with the current GitHub token", async () => {
    const readGithubAccessToken = vi.fn(async () => "token");
    const fetchGithubOrganizations = vi.fn(async () => ["Loopworks"]);

    await expect(
      authorizeGithubSession({
        session: {
          expires: "2026-06-27T00:00:00.000Z",
          user: {
            id: "user_123",
            githubLogin: "org-member",
          },
        },
        config: {
          bypass: false,
          allowedGithubUsers: [],
          allowedGithubOrgs: ["loopworks"],
        },
        readGithubAccessToken,
        fetchGithubOrganizations,
      }),
    ).resolves.toMatchObject({
      authorized: true,
      reason: "github_org",
    });

    expect(readGithubAccessToken).toHaveBeenCalledWith("user_123");
    expect(fetchGithubOrganizations).toHaveBeenCalledWith({
      accessToken: "token",
    });
  });
});
