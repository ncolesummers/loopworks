import { authorizeGithubSession, clearGithubOrganizationCache } from "@/lib/auth/session-policy";

const baseConfig = {
  bypass: false,
  allowedGithubUsers: ["ncolesummers"],
  allowedGithubOrgs: [],
};

describe("auth session policy", () => {
  afterEach(() => {
    clearGithubOrganizationCache();
  });

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

  it("caches successful organization allowlist checks for a short TTL", async () => {
    const readGithubAccessToken = vi.fn(async () => "token");
    const fetchGithubOrganizations = vi.fn(async () => ["Loopworks"]);
    const session = {
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        id: "user_123",
        githubLogin: "org-member",
      },
    };
    const config = {
      bypass: false,
      allowedGithubUsers: [],
      allowedGithubOrgs: ["loopworks"],
    };

    await authorizeGithubSession({
      session,
      config,
      readGithubAccessToken,
      fetchGithubOrganizations,
      now: new Date("2026-06-27T00:00:00.000Z"),
    });
    await expect(
      authorizeGithubSession({
        session,
        config,
        readGithubAccessToken,
        fetchGithubOrganizations,
        now: new Date("2026-06-27T00:00:30.000Z"),
      }),
    ).resolves.toMatchObject({
      authorized: true,
      reason: "github_org",
    });

    expect(readGithubAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchGithubOrganizations).toHaveBeenCalledTimes(1);
  });

  it("refreshes cached organization membership after the TTL expires", async () => {
    const readGithubAccessToken = vi.fn(async () => "token");
    const fetchGithubOrganizations = vi.fn(async () => ["Loopworks"]);
    const session = {
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        id: "user_123",
        githubLogin: "org-member",
      },
    };
    const config = {
      bypass: false,
      allowedGithubUsers: [],
      allowedGithubOrgs: ["loopworks"],
    };

    await authorizeGithubSession({
      session,
      config,
      readGithubAccessToken,
      fetchGithubOrganizations,
      now: new Date("2026-06-27T00:00:00.000Z"),
    });
    await authorizeGithubSession({
      session,
      config,
      readGithubAccessToken,
      fetchGithubOrganizations,
      now: new Date("2026-06-27T00:01:01.000Z"),
    });

    expect(readGithubAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchGithubOrganizations).toHaveBeenCalledTimes(2);
  });

  it("does not cache denied organization checks", async () => {
    const readGithubAccessToken = vi.fn(async () => "token");
    const fetchGithubOrganizations = vi.fn(async () => []);
    const session = {
      expires: "2026-06-27T00:00:00.000Z",
      user: {
        id: "user_123",
        githubLogin: "org-member",
      },
    };

    for (const now of [
      new Date("2026-06-27T00:00:00.000Z"),
      new Date("2026-06-27T00:00:30.000Z"),
    ]) {
      await expect(
        authorizeGithubSession({
          session,
          config: {
            bypass: false,
            allowedGithubUsers: [],
            allowedGithubOrgs: ["loopworks"],
          },
          readGithubAccessToken,
          fetchGithubOrganizations,
          now,
        }),
      ).resolves.toMatchObject({
        authorized: false,
        reason: "not_allowlisted",
      });
    }

    expect(readGithubAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchGithubOrganizations).toHaveBeenCalledTimes(2);
  });
});
