import {
  evaluateAuthAllowlist,
  isAllowedGithubIdentity,
  readAuthAllowlistConfig,
} from "@/lib/auth/allowlist";

describe("auth allowlist", () => {
  it("allows bypass mode", () => {
    const config = readAuthAllowlistConfig({
      LOOPWORKS_AUTH_BYPASS: "true",
      NODE_ENV: "development",
    });

    expect(
      evaluateAuthAllowlist(
        {
          githubLogin: null,
        },
        config,
      ),
    ).toEqual({
      allowed: true,
      reason: "bypass",
      matchedValue: "LOOPWORKS_AUTH_BYPASS",
    });
  });

  it("disables bypass mode in production", () => {
    const config = readAuthAllowlistConfig({
      LOOPWORKS_AUTH_BYPASS: "true",
      NODE_ENV: "production",
    });

    expect(config.bypass).toBe(false);
  });

  it("allows a configured GitHub user", () => {
    const allowed = isAllowedGithubIdentity(
      {
        githubLogin: "ncoleSummers",
      },
      {
        bypass: false,
        allowedGithubUsers: ["ncolesummers"],
        allowedGithubOrgs: [],
      },
    );

    expect(allowed).toBe(true);
  });

  it("allows a configured GitHub organization", () => {
    const decision = evaluateAuthAllowlist(
      {
        githubLogin: "eve-bot",
        githubOrganizations: ["OpenAI", "Loopworks"],
      },
      {
        bypass: false,
        allowedGithubUsers: [],
        allowedGithubOrgs: ["loopworks"],
      },
    );

    expect(decision).toEqual({
      allowed: true,
      reason: "github_org",
      matchedValue: "loopworks",
    });
  });

  it("rejects a missing GitHub login when bypass is off", () => {
    expect(
      evaluateAuthAllowlist(
        {},
        {
          bypass: false,
          allowedGithubUsers: ["ncolesummers"],
          allowedGithubOrgs: [],
        },
      ),
    ).toEqual({
      allowed: false,
      reason: "missing_github_login",
    });
  });

  it("rejects a GitHub identity outside the configured user and org allowlists", () => {
    expect(
      evaluateAuthAllowlist(
        {
          githubLogin: "unknown-operator",
          githubOrganizations: ["external-org"],
        },
        {
          bypass: false,
          allowedGithubUsers: ["ncolesummers"],
          allowedGithubOrgs: ["loopworks"],
        },
      ),
    ).toEqual({
      allowed: false,
      reason: "not_allowlisted",
    });
  });
});
