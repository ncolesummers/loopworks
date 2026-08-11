import { fetchGithubOrganizationLogins, fetchGithubOrganizationLookup } from "@/lib/auth/github";

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

  it.each(["http failure", "network failure", "invalid JSON"])(
    "reports a GitHub organization lookup %s as unavailable",
    async (failure) => {
      const fetchImpl =
        failure === "http failure"
          ? vi.fn(async () => new Response("unavailable", { status: 503 }))
          : failure === "network failure"
            ? vi.fn(async () => {
                throw new Error("GitHub is unreachable");
              })
            : vi.fn(async () => new Response("not-json", { status: 200 }));

      await expect(
        fetchGithubOrganizationLookup({
          accessToken: "token",
          fetchImpl,
        }),
      ).resolves.toEqual({ status: "unavailable" });
    },
  );
});
