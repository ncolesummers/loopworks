import { applyGithubLoginToSession, mapGithubProfileToAuthUser } from "@/lib/auth/identity";

describe("auth identity helpers", () => {
  it("maps GitHub OAuth profiles into persisted Auth.js users", () => {
    expect(
      mapGithubProfileToAuthUser({
        id: 22808397,
        login: "ncolesummers",
        name: null,
        email: "nathan@example.com",
        avatar_url: "https://avatars.githubusercontent.com/u/22808397?v=4",
      }),
    ).toEqual({
      id: "22808397",
      name: "ncolesummers",
      email: "nathan@example.com",
      image: "https://avatars.githubusercontent.com/u/22808397?v=4",
      githubLogin: "ncolesummers",
    });
  });

  it("exposes persisted GitHub login on database-backed sessions", () => {
    const session = applyGithubLoginToSession(
      {
        expires: "2026-06-27T00:00:00.000Z",
        user: {
          name: "Nathan Summers",
          email: "nathan@example.com",
          image: null,
        },
      },
      {
        name: "Nathan Summers",
        email: "nathan@example.com",
        githubLogin: "ncolesummers",
      },
    );

    expect(session.user.githubLogin).toBe("ncolesummers");
  });
});
