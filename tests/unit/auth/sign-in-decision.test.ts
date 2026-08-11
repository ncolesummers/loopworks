import { resolveGithubSignInDecision } from "@/lib/auth/sign-in-decision";

const config = {
  bypass: false,
  allowedGithubUsers: ["approved-user"],
  allowedGithubOrgs: ["loopworks"],
};

describe("GitHub sign-in decision", () => {
  it("keeps the existing allowlist decision when organization evidence is available", () => {
    expect(
      resolveGithubSignInDecision({
        config,
        githubLogin: "approved-user",
        githubOrganizations: { logins: [], status: "available" },
      }),
    ).toEqual({
      decision: {
        allowed: true,
        matchedValue: "approved-user",
        reason: "github_user",
      },
      outcome: "decision",
    });
  });

  it("does not turn an unavailable organization lookup into an approval denial", () => {
    expect(
      resolveGithubSignInDecision({
        config,
        githubLogin: "unknown-user",
        githubOrganizations: { status: "unavailable" },
      }),
    ).toEqual({
      outcome: "unavailable",
      redirect: "/sign-in?error=Configuration",
    });
  });

  it("keeps a directly approved user allowed when organization evidence is unavailable", () => {
    expect(
      resolveGithubSignInDecision({
        config,
        githubLogin: "approved-user",
        githubOrganizations: { status: "unavailable" },
      }),
    ).toEqual({
      decision: {
        allowed: true,
        matchedValue: "approved-user",
        reason: "github_user",
      },
      outcome: "decision",
    });
  });
});
