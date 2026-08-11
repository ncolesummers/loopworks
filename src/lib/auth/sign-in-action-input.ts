/**
 * Keep server-action input handling and the provider URL guard free of Auth.js and Next.js
 * imports so both security boundaries can be tested without booting the auth configuration.
 */
export function readSignInCallbackUrl(formData: FormData | null | undefined): string | undefined {
  if (!(formData instanceof FormData)) {
    return undefined;
  }

  const callbackUrl = formData.get("callbackUrl");
  return typeof callbackUrl === "string" ? callbackUrl : undefined;
}

export function isGithubAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/login/oauth/authorize"
    );
  } catch {
    return false;
  }
}
