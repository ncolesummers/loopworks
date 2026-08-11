import { authPages } from "@/lib/auth/pages";
import { resolveSignInRedirect } from "@/lib/auth/sign-in-redirect";

describe("sign-in redirect sanitizer", () => {
  it("keeps a same-origin path with its query string", () => {
    expect(resolveSignInRedirect("/loops?filter=agent-ready")).toBe("/loops?filter=agent-ready");
  });

  /**
   * The proxy sets `callbackUrl` to `request.nextUrl.href`, so the common case is an absolute URL
   * rather than a path.
   */
  it("reduces an absolute URL to its path and query", () => {
    expect(resolveSignInRedirect("https://loopworks.vercel.app/runs?run=abc#frag")).toBe(
      "/runs?run=abc",
    );
  });

  it("discards the origin rather than comparing it, so an off-origin target degrades to a path", () => {
    expect(resolveSignInRedirect("https://github.com/loopworks-off-origin")).toBe(
      "/loopworks-off-origin",
    );
  });

  /**
   * The reduced path is what browsers resolve, so it has to survive the same checks a
   * hand-written path does. `new URL("//github.com", origin)` is `https://github.com/`, and
   * an absolute URL can carry that shape in its own pathname.
   */
  it.each([
    ["https://github.com//off-origin-target", "double-slash pathname"],
    ["https://github.com/\\off-origin-target", "backslash pathname"],
    ["https://github.com/\\\\off-origin-target", "double-backslash pathname"],
  ])("refuses %j, whose reduced path is protocol-relative (%s)", (value) => {
    expect(resolveSignInRedirect(value)).toBe("/");
  });

  /**
   * Browsers strip tab, newline, and carriage return from a URL before resolving it, so
   * `/\t/github.com` becomes `//github.com`. Removing them here means the value that is checked is
   * the value that is used.
   */
  it.each([
    ["/\t/github.com", "tab"],
    ["/\n/github.com", "newline"],
    ["/\r/github.com", "carriage return"],
  ])("refuses %j, which a browser collapses to protocol-relative (%s)", (value) => {
    expect(resolveSignInRedirect(value)).toBe("/");
  });

  it("keeps a percent-encoded control character, which browsers do not decode", () => {
    expect(resolveSignInRedirect("/%09/loops")).toBe("/%09/loops");
  });

  it.each([
    ["//github.com", "protocol-relative"],
    ["/\\github.com", "backslash protocol-relative"],
    ["javascript:alert(1)", "javascript scheme"],
    ["data:text/html,<script>", "data scheme"],
    ["", "empty"],
    ["   ", "whitespace"],
    ["not a url", "unparseable"],
  ])("falls back to the portal root for %s (%s)", (value) => {
    expect(resolveSignInRedirect(value)).toBe("/");
  });

  it("falls back for a missing value", () => {
    expect(resolveSignInRedirect(undefined)).toBe("/");
    expect(resolveSignInRedirect(null)).toBe("/");
  });

  /**
   * Landing back here after a successful sign-in is a dead end, and a `callbackUrl` starting with
   * the error page is the exact condition @auth/core treats as `ErrorPageLoop`.
   */
  it("never lands the operator back on the sign-in surface", () => {
    expect(resolveSignInRedirect(authPages.signIn)).toBe("/");
    expect(resolveSignInRedirect(`${authPages.signIn}?error=AccessDenied`)).toBe("/");
    expect(resolveSignInRedirect(`https://loopworks.vercel.app${authPages.signIn}`)).toBe("/");
  });

  it("never lands the operator on an Auth.js internal route", () => {
    expect(resolveSignInRedirect("/api/auth/callback/github")).toBe("/");
    expect(resolveSignInRedirect("/api/auth/signout")).toBe("/");
  });

  it("keeps other api routes reachable, since only Auth.js internals are excluded", () => {
    expect(resolveSignInRedirect("/api/github/install")).toBe("/api/github/install");
  });
});
