import type { NextResponse } from "next/server";

/**
 * The PKCE verifier is written by whichever route starts the authorization phase
 * and read back by the single registered callback. Two entries exist — the
 * Setup-URL return and operator-initiated reconciliation (#151) — so the name and
 * attributes live here rather than being restated per route, where they could
 * drift into a cookie the callback never finds.
 *
 * ADR 0021: the verifier is transient browser state and is never persisted.
 */
export const githubInstallationPkceCookieName = "loopworks-github-install-pkce";

const githubInstallationPkceCookieMaxAgeSeconds = 10 * 60;

export function readGithubInstallationPkceCookie(request: Request): string | null {
  const raw = request.headers
    .get("cookie")
    ?.match(new RegExp(`(?:^|;\\s*)${githubInstallationPkceCookieName}=([^;]+)`))?.[1];
  return raw ? decodeURIComponent(raw) : null;
}

export function setGithubInstallationPkceCookie(
  response: NextResponse,
  input: { requestUrl: string; verifier: string },
): NextResponse {
  response.cookies.set(githubInstallationPkceCookieName, input.verifier, {
    httpOnly: true,
    maxAge: githubInstallationPkceCookieMaxAgeSeconds,
    sameSite: "lax",
    secure: new URL(input.requestUrl).protocol === "https:",
  });
  return response;
}

export function clearGithubInstallationPkceCookie(response: NextResponse): NextResponse {
  response.cookies.delete(githubInstallationPkceCookieName);
  return response;
}
