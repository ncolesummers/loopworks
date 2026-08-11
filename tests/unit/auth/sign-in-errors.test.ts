import { STATUS_META } from "@/components/ui/status-badge";
import {
  resolveSignInError,
  signInErrorNotices,
  signInFallbackNotice,
} from "@/lib/auth/sign-in-errors";

const allNotices = [...Object.values(signInErrorNotices), signInFallbackNotice];

describe("sign-in error vocabulary", () => {
  it("covers every Auth.js error type this configuration can actually surface", () => {
    expect(Object.keys(signInErrorNotices).sort()).toEqual([
      "AccessDenied",
      "Configuration",
      "MissingCSRF",
      "OAuthAccountNotLinked",
      "OAuthCallbackError",
    ]);
  });

  it("gives every notice a title, a detail, and a next step", () => {
    for (const notice of allNotices) {
      expect(notice.title.length, notice.title).toBeGreaterThan(0);
      expect(notice.detail.length, notice.title).toBeGreaterThan(0);
      expect(notice.nextStep.length, notice.title).toBeGreaterThan(0);
    }
  });

  it("uses only statuses the shared vocabulary defines", () => {
    for (const notice of allNotices) {
      expect(STATUS_META[notice.status], notice.title).toBeDefined();
    }
  });
});

describe("resolveSignInError fails closed", () => {
  it("maps a known code to its notice", () => {
    expect(resolveSignInError("AccessDenied")).toBe(signInErrorNotices.AccessDenied);
  });

  it("returns nothing when no error was reported", () => {
    expect(resolveSignInError(undefined)).toBeUndefined();
    expect(resolveSignInError("")).toBeUndefined();
  });

  /**
   * The proxy clones the whole request URL onto the sign-in redirect and `/api/auth/error`
   * forwards its `error` parameter verbatim, so this value is attacker-controlled. Anything
   * outside the closed map has to collapse to the generic notice rather than reach the surface.
   */
  it.each([
    "not-a-real-code",
    "<img src=x onerror=alert(1)>",
    "AccessDenied-but-not-really",
    "Configuration ",
  ])("collapses the unrecognized value %j to the generic notice", (value) => {
    expect(resolveSignInError(value)).toBe(signInFallbackNotice);
  });

  it("collapses a repeated parameter rather than trusting the first value", () => {
    expect(resolveSignInError(["AccessDenied", "Configuration"])).toBe(signInFallbackNotice);
  });
});

describe("sign-in copy discloses nothing", () => {
  const forbidden = [
    // Allowlist mechanism and its configuration.
    "allowlist",
    "LOOPWORKS_ALLOWED",
    "ALLOWED_GITHUB",
    "AUTH_SECRET",
    "AUTH_GITHUB",
    "ncolesummers",
    // Auth material.
    "token",
    "secret",
    "scope",
    "read:user",
    "read:org",
    "oauth",
    "client id",
    // Framework internals leaking as operator copy.
    "AccessDenied",
    "OAuthCallbackError",
    "OAuthAccountNotLinked",
    "MissingCSRF",
    "authjs",
    // Self-service signup, which this product does not offer.
    "sign up",
    "signup",
    "create an account",
    "request access",
  ];

  it.each(forbidden)("never says %j", (term) => {
    for (const notice of allNotices) {
      const copy = `${notice.title} ${notice.detail} ${notice.nextStep}`.toLowerCase();
      expect(copy, `${notice.title} leaked ${term}`).not.toContain(term.toLowerCase());
    }
  });

  /**
   * #103, #104, #107, and #108 are all still open, so there is no public docs or landing route to
   * link to. Enforcing it here means a copy edit cannot introduce a dead link later.
   */
  it("links nowhere, because no public docs or landing route exists yet", () => {
    for (const notice of allNotices) {
      const copy = `${notice.title} ${notice.detail} ${notice.nextStep}`;
      expect(copy, notice.title).not.toContain("http");
    }
  });

  it("states the denial as an outcome with a human next step, not as a mechanism", () => {
    const denied = signInErrorNotices.AccessDenied;
    expect(denied.detail.toLowerCase()).toContain("not approved");
    expect(denied.nextStep.toLowerCase()).toContain("operator");
  });
});
