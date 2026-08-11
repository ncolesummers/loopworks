import { isGithubAuthorizationUrl, readSignInCallbackUrl } from "@/lib/auth/sign-in-action-input";

describe("sign-in action input", () => {
  it.each([
    ["https://github.com/login/oauth/authorize?client_id=client", true],
    ["https://github.com/logout", false],
    ["https://github.com:444/login/oauth/authorize", false],
    ["http://github.com/login/oauth/authorize", false],
    ["https://api.github.com/login/oauth/authorize", false],
  ])("accepts only the GitHub OAuth authorization endpoint: %s", (value, expected) => {
    expect(isGithubAuthorizationUrl(value)).toBe(expected);
  });

  it("reads only a string callback URL from a genuine FormData value", () => {
    const formData = new FormData();
    formData.append("callbackUrl", "/loops");

    expect(readSignInCallbackUrl(formData)).toBe("/loops");
  });

  it.each([
    [null, "missing value"],
    [undefined, "undefined value"],
    [{}, "forged object"],
  ])("treats malformed action input as no callback URL (%s)", (value, _description) => {
    expect(readSignInCallbackUrl(value as FormData | null | undefined)).toBeUndefined();
  });
});
