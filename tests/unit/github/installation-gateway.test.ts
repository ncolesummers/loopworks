/** @vitest-environment node */

import { generateKeyPairSync } from "node:crypto";

import { HttpResponse, http } from "msw";

import { createGithubInstallationGateway } from "@/lib/github/installation-gateway";

import { mswServer } from "../../helpers/msw";

/**
 * The app JWT is signed locally, so the default factory needs a real RSA key even though no
 * request leaves the process.
 */
function generateAppPrivateKey(): string {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type: "pkcs1" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }).privateKey;
}

function repositoryPayload(
  id: number,
  name: string,
  overrides: { archived?: boolean; default_branch?: string; private?: boolean } = {},
) {
  return {
    archived: false,
    default_branch: "main",
    full_name: `loopworks-org/${name}`,
    id,
    name,
    owner: { login: "loopworks-org" },
    private: false,
    ...overrides,
  };
}

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
      oauthFetchImpl: fetchImpl,
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
      oauthFetchImpl: vi.fn(async () => responses.shift() ?? Response.json({})),
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
      oauthFetchImpl: vi.fn(),
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

  it("normalizes the operator's own installations and drops malformed entries", async () => {
    const paginate = vi.fn(async () => [
      { app_id: 124, id: 124_001 },
      { app_id: 999, id: 999_001 },
      { app_id: 124, id: "not-a-number" },
      { app_id: null, id: 124_002 },
      null,
    ]);
    const gateway = createGithubInstallationGateway({
      appId: 124,
      createAppClient: () => ({ request: vi.fn() }),
      createUserClient: () => ({ paginate, request: vi.fn() }),
      oauthFetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.listUserInstallations("ghu_token")).resolves.toEqual([
      { appId: 124, installationId: 124_001 },
      { appId: 999, installationId: 999_001 },
    ]);
    expect(paginate).toHaveBeenCalledWith("GET /user/installations", { per_page: 100 });
  });

  it("paginates the operator's installations through the default client, with no injected fake", async () => {
    const requestedPages: (string | null)[] = [];
    const authorizations: (string | null)[] = [];
    mswServer.use(
      http.get("https://api.github.com/user/installations", ({ request }) => {
        const url = new URL(request.url);
        const page = url.searchParams.get("page");
        requestedPages.push(page);
        authorizations.push(request.headers.get("authorization"));
        // The live endpoint wraps the array in a counted envelope and links the next page; only a
        // real paginating client unwraps the envelope and follows the link.
        if (page === "2") {
          return HttpResponse.json({
            installations: [{ app_id: 124, id: 124_002 }],
            total_count: 2,
          });
        }
        return HttpResponse.json(
          { installations: [{ app_id: 124, id: 124_001 }], total_count: 2 },
          {
            headers: {
              link: '<https://api.github.com/user/installations?per_page=100&page=2>; rel="next"',
            },
          },
        );
      }),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
    });

    await expect(gateway.listUserInstallations("ghu_token")).resolves.toEqual([
      { appId: 124, installationId: 124_001 },
      { appId: 124, installationId: 124_002 },
    ]);
    await expect(gateway.userCanAccessInstallation("ghu_token", 124_002)).resolves.toBe(true);
    await expect(gateway.userCanAccessInstallation("ghu_token", 777_001)).resolves.toBe(false);
    expect(requestedPages).toEqual([null, "2", null, "2", null, "2"]);
    expect(new Set(authorizations)).toEqual(new Set(["token ghu_token"]));
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
      oauthFetchImpl: vi.fn(),
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
      oauthFetchImpl: vi.fn(),
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
      oauthFetchImpl: vi.fn(),
      privateKey: "private-key",
    });

    await expect(gateway.listInstallationRepositories(124_001)).rejects.toThrow(
      "github_repository_verification_failed",
    );
  });

  it("paginates installation repositories through the default client, with no injected fake", async () => {
    const tokenRequests: number[] = [];
    const requestedPages: (string | null)[] = [];
    const repositoryAuthorization: (string | null)[] = [];
    mswServer.use(
      http.post<{ installationId: string }>(
        "https://api.github.com/app/installations/:installationId/access_tokens",
        ({ params, request }) => {
          tokenRequests.push(Number(params.installationId));
          // Minting the token is itself app-authenticated, with a locally signed JWT.
          expect(request.headers.get("authorization")).toMatch(/^bearer ey/i);
          return HttpResponse.json(
            { expires_at: "2099-01-01T00:00:00Z", token: "ghs_installation" },
            { status: 201 },
          );
        },
      ),
      http.get("https://api.github.com/installation/repositories", ({ request }) => {
        const url = new URL(request.url);
        const page = url.searchParams.get("page");
        requestedPages.push(page);
        repositoryAuthorization.push(request.headers.get("authorization"));
        // The live endpoint wraps the array in a counted envelope and links the next page; only a
        // real paginating client unwraps the envelope and follows the link.
        if (page === "2") {
          return HttpResponse.json({
            repositories: [
              repositoryPayload(900_002, "agent", { archived: true, default_branch: "trunk" }),
            ],
            repository_selection: "selected",
            total_count: 2,
          });
        }
        return HttpResponse.json(
          {
            repositories: [repositoryPayload(900_001, "portal", { private: true })],
            repository_selection: "selected",
            total_count: 2,
          },
          {
            headers: {
              link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
            },
          },
        );
      }),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
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
    expect(tokenRequests).toEqual([124_001]);
    expect(requestedPages).toEqual([null, "2"]);
    // The minted token must actually reach the repository calls; an unauthenticated client would
    // 401 in production while every stub here still answered.
    expect(repositoryAuthorization).toEqual(["token ghs_installation", "token ghs_installation"]);
  });

  it("mints one installation token for repeated reads on the same gateway", async () => {
    let mints = 0;
    mswServer.use(
      http.post("https://api.github.com/app/installations/:installationId/access_tokens", () => {
        mints += 1;
        return HttpResponse.json(
          { expires_at: "2099-01-01T00:00:00Z", token: "ghs_installation" },
          { status: 201 },
        );
      }),
      http.get("https://api.github.com/installation/repositories", () =>
        HttpResponse.json({ repositories: [], repository_selection: "selected", total_count: 0 }),
      ),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
    });

    await gateway.listInstallationRepositories(124_001);
    await gateway.listInstallationRepositories(124_001);

    // Applying a selection reads twice; one mint per read would double the cost of every Save
    // against the per-installation rate limit.
    expect(mints).toBe(1);
  });

  it("does not cache a failed token mint", async () => {
    let mints = 0;
    mswServer.use(
      http.post("https://api.github.com/app/installations/:installationId/access_tokens", () => {
        mints += 1;
        // First attempt fails; a cached rejection would poison the gateway for its whole lifetime.
        if (mints === 1) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json(
          { expires_at: "2099-01-01T00:00:00Z", token: "ghs_installation" },
          { status: 201 },
        );
      }),
      http.get("https://api.github.com/installation/repositories", () =>
        HttpResponse.json({ repositories: [], repository_selection: "selected", total_count: 0 }),
      ),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
    });

    await expect(gateway.listInstallationRepositories(124_001)).rejects.toThrow();
    await expect(gateway.listInstallationRepositories(124_001)).resolves.toEqual([]);
    expect(mints).toBe(2);
  });

  it("refuses an installation token response that carries no usable token", async () => {
    mswServer.use(
      http.post("https://api.github.com/app/installations/:installationId/access_tokens", () =>
        // A renamed or absent field would otherwise build an unauthenticated client that fails
        // later, as an opaque 401 against a different endpoint.
        HttpResponse.json({ expires_at: "2099-01-01T00:00:00Z" }, { status: 201 }),
      ),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
    });

    await expect(gateway.listInstallationRepositories(124_001)).rejects.toThrow(
      "github_installation_token_failed",
    );
  });

  it("verifies an installation through the default app client, with no injected fake", async () => {
    mswServer.use(
      http.get("https://api.github.com/app/installations/124001", ({ request }) => {
        expect(request.headers.get("authorization")).toMatch(/^bearer ey/i);
        return HttpResponse.json({
          account: { id: 12_400, login: "loopworks-sandbox", type: "Organization" },
          app_id: 124,
          id: 124_001,
          repository_selection: "selected",
          suspended_at: null,
        });
      }),
    );
    const gateway = createGithubInstallationGateway({
      appId: 124,
      privateKey: generateAppPrivateKey(),
    });

    await expect(gateway.verifyAppInstallation(124_001)).resolves.toEqual({
      accountId: 12_400,
      accountLogin: "loopworks-sandbox",
      accountType: "Organization",
      appId: 124,
      installationId: 124_001,
      repositorySelection: "selected",
      suspendedAt: null,
    });
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
      oauthFetchImpl: vi.fn(),
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
