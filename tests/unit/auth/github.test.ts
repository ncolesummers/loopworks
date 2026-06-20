import { fetchGithubOrganizationLogins } from "@/lib/auth/github";

describe("GitHub auth helpers", () => {
  it("maps organization logins from the GitHub API response", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify([{ login: "Loopworks" }, { login: "OpenAI" }]), {
        status: 200,
      });
    });

    await expect(
      fetchGithubOrganizationLogins({
        accessToken: "token",
        fetchImpl,
      }),
    ).resolves.toEqual(["Loopworks", "OpenAI"]);

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/user/orgs",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
        }),
      }),
    );
  });

  it("returns an empty list when the GitHub API rejects the request", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));

    await expect(
      fetchGithubOrganizationLogins({
        accessToken: "token",
        fetchImpl,
      }),
    ).resolves.toEqual([]);
  });
});
