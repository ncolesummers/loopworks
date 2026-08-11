import { authPages } from "@/lib/auth/pages";

const portalRoot = "/";

/**
 * Reduce an inbound `callbackUrl` to a same-origin path.
 *
 * The proxy sets `callbackUrl` to `request.nextUrl.href`, so the value normally arrives as an
 * absolute URL, and anything at all can be typed into the query string. Rather than compare
 * origins - which under `trustHost: true` means trusting a `Host` header - this discards the
 * origin outright and forwards only a path, so an off-origin target degrades into a harmless
 * same-origin one instead of being echoed into the DOM or into `redirectTo`.
 *
 * Auth.js's own `redirect` callback applies a similar rule downstream, but the sign-in page
 * renders this value into a hidden field before Auth.js ever sees it, and the two exclusions
 * below are ours rather than the framework's.
 *
 * Reducing to a path is not sufficient on its own: a URL's own pathname can be `//github.com`,
 * which a browser resolves off-origin. The reduced path is therefore re-checked, not trusted.
 */
export function resolveSignInRedirect(value: string | null | undefined): string {
  // Browsers strip tab, newline, and carriage return from a URL before resolving it, so
  // `/\t/github.com` reaches the network as `//github.com`. Removing them first means the value
  // checked below is the value the browser will actually use.
  const raw = value?.replace(/[\t\n\r]/g, "").trim();
  if (!raw) {
    return portalRoot;
  }

  const path = raw.startsWith("/") ? readRelativePath(raw) : readAbsolutePath(raw);
  // Checked after both branches, not inside one: an absolute URL's own pathname can be
  // `//github.com`, which resolves off-origin exactly like a hand-written protocol-relative
  // path does.
  if (path === null || !isSameOriginPath(path)) {
    return portalRoot;
  }

  const pathname = path.split("?", 1)[0] ?? portalRoot;

  // Returning here after a successful sign-in is a dead end, and a `callbackUrl` that starts
  // with the error page is the exact condition @auth/core reports as `ErrorPageLoop`.
  if (pathname === authPages.signIn || pathname === authPages.error) {
    return portalRoot;
  }

  // Auth.js owns these; handing the operator to one as a landing target only produces a
  // framework error.
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) {
    return portalRoot;
  }

  return path;
}

/**
 * A path is same-origin only if it starts with exactly one slash. `//host` and `/\host` are both
 * protocol-relative to a browser, so they leave the origin despite the leading slash.
 */
function isSameOriginPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

function readRelativePath(raw: string): string {
  return raw.split("#", 1)[0] ?? "";
}

function readAbsolutePath(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return `${parsed.pathname}${parsed.search}`;
}
