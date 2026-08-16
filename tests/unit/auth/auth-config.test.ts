/** @vitest-environment node */

const authHarness = vi.hoisted(() => ({
  config: undefined as
    | {
        callbacks?: {
          signIn?: (input: {
            account?: {
              access_token?: string;
              provider?: string;
              providerAccountId?: string;
            } | null;
            profile?: { login?: string };
          }) => Promise<boolean | string>;
        };
      }
    | undefined,
  refreshGithubAccessTokenForAccount: vi.fn(async () => undefined),
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config) => {
    authHarness.config = config;
    return {
      auth: vi.fn(),
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  }),
}));

vi.mock("@/lib/auth/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/accounts")>()),
  refreshGithubAccessTokenForAccount: authHarness.refreshGithubAccessTokenForAccount,
}));

describe("Auth.js GitHub account persistence", () => {
  beforeAll(async () => {
    vi.stubEnv("LOOPWORKS_ALLOWED_GITHUB_USERS", "octocat");
    await import("@/auth");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("rotates the persisted access token through the configured sign-in callback", async () => {
    const signIn = authHarness.config?.callbacks?.signIn;
    expect(signIn).toBeTypeOf("function");

    await expect(
      signIn?.({
        account: {
          access_token: "github-user-token-rotated",
          provider: "github",
          providerAccountId: "22808397",
        },
        profile: { login: "octocat" },
      }),
    ).resolves.toBe(true);

    expect(authHarness.refreshGithubAccessTokenForAccount).toHaveBeenCalledExactlyOnceWith({
      accessToken: "github-user-token-rotated",
      providerAccountId: "22808397",
    });
  });
});
