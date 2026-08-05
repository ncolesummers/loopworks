/** @vitest-environment node */

import { createGithubInstallationGateway } from "@/lib/github/installation-gateway";

describe("GitHub installation verification gateway", () => {
  it("exchanges an authorization code with PKCE without returning refresh material", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body?.toString()).toContain("client_secret=client-secret");
      expect(init?.body?.toString()).toContain("code_verifier=pkce-verifier");
      return Response.json({
        access_token: "ghu_transient",
        refresh_token: "ghr_must_not_escape",
      });
    });
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl,
      privateKey: "private-key",
    });

    await expect(
      gateway.exchangeUserCode({
        clientId: "client-id",
        clientSecret: "client-secret",
        code: "one-time-code",
        codeVerifier: "pkce-verifier",
        redirectUri: "https://loopworks.example/api/github/install/callback",
      }),
    ).resolves.toBe("ghu_transient");
  });

  it("rejects HTTP-200 OAuth error payloads and missing tokens", async () => {
    const responses = [Response.json({ error: "bad_verification_code" }), Response.json({})];
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl: vi.fn(async () => responses.shift() ?? Response.json({})),
      privateKey: "private-key",
    });
    const input = {
      clientId: "client-id",
      clientSecret: "client-secret",
      code: "code",
      codeVerifier: "verifier",
      redirectUri: "https://loopworks.example/api/github/install/callback",
    };

    await expect(gateway.exchangeUserCode(input)).rejects.toThrow("github_oauth_exchange_failed");
    await expect(gateway.exchangeUserCode(input)).rejects.toThrow("github_oauth_exchange_failed");
  });

  it("normalizes app installations and searches every user-accessible page", async () => {
    const appRequest = vi.fn(async () => ({
      data: {
        id: 124_001,
        app_id: 124,
        account: { id: 12_400, login: "loopworks-org", type: "Organization" },
        repository_selection: "selected",
        suspended_at: null,
      },
    }));
    const userRequest = vi.fn(async () => ({ data: { login: "NColesummers" } }));
    const paginate = vi.fn(async () => [{ id: 1 }, { id: 124_001 }]);
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: appRequest }),
      createUserClient: () => ({ paginate, request: userRequest }),
      fetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.verifyAppInstallation(124_001)).resolves.toEqual({
      accountId: 12_400,
      accountLogin: "loopworks-org",
      accountType: "Organization",
      appId: 124,
      installationId: 124_001,
      repositorySelection: "selected",
      suspendedAt: null,
    });
    await expect(gateway.getAuthenticatedUserLogin("ghu_token")).resolves.toBe("NColesummers");
    await expect(gateway.userCanAccessInstallation("ghu_token", 124_001)).resolves.toBe(true);
    expect(paginate).toHaveBeenCalledWith("GET /user/installations", { per_page: 100 });
  });

  it("normalizes every repository page the installation can reach", async () => {
    const paginate = vi.fn(async () => [
      {
        id: 900_001,
        name: "portal",
        full_name: "loopworks-org/portal",
        owner: { login: "loopworks-org" },
        default_branch: "main",
        private: true,
        archived: false,
      },
      {
        id: 900_002,
        name: "agent",
        full_name: "loopworks-org/agent",
        owner: { login: "loopworks-org" },
        default_branch: "trunk",
        private: false,
        archived: true,
      },
    ]);
    const createInstallationClient = vi.fn(async () => ({ paginate }));
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createInstallationClient,
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.listInstallationRepositories(124_001)).resolves.toEqual([
      {
        archived: false,
        defaultBranch: "main",
        fullName: "loopworks-org/portal",
        githubRepoId: 900_001,
        name: "portal",
        owner: "loopworks-org",
        private: true,
      },
      {
        archived: true,
        defaultBranch: "trunk",
        fullName: "loopworks-org/agent",
        githubRepoId: 900_002,
        name: "agent",
        owner: "loopworks-org",
        private: false,
      },
    ]);
    expect(createInstallationClient).toHaveBeenCalledWith(124_001);
    expect(paginate).toHaveBeenCalledWith("GET /installation/repositories", { per_page: 100 });
  });

  it("returns an empty list when the installation reaches no repositories", async () => {
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createInstallationClient: async () => ({ paginate: vi.fn(async () => []) }),
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.listInstallationRepositories(124_001)).resolves.toEqual([]);
  });

  it("rejects a malformed repository entry instead of importing a partial identity", async () => {
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createInstallationClient: async () => ({
        paginate: vi.fn(async () => [
          {
            id: 900_001,
            name: "portal",
            full_name: "loopworks-org/portal",
            owner: null,
            default_branch: "main",
          },
        ]),
      }),
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.listInstallationRepositories(124_001)).rejects.toThrow(
      "github_repository_verification_failed",
    );
  });

  it("rejects malformed or suspended installation responses", async () => {
    const responses = [
      { data: { id: 124_001, app_id: 124, account: null, repository_selection: "selected" } },
      {
        data: {
          id: 124_001,
          app_id: 124,
          account: { id: 1, login: "org", type: "Organization" },
          repository_selection: "selected",
          suspended_at: "2026-08-03T00:00:00Z",
        },
      },
    ];
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({
        request: vi.fn(async () => {
          const response = responses.shift();
          if (!response) throw new Error("Missing test response.");
          return response;
        }),
      }),
      createUserClient: () => ({ paginate: vi.fn(), request: vi.fn() }),
      fetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.verifyAppInstallation(124_001)).rejects.toThrow(
      "github_installation_verification_failed",
    );
    await expect(gateway.verifyAppInstallation(124_001)).rejects.toThrow(
      "github_installation_verification_failed",
    );
  });
});
