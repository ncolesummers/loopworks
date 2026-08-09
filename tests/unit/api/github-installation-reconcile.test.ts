/** @vitest-environment node */

import { SpanStatusCode } from "@opentelemetry/api";

import {
  handleGithubInstallationReconcileStart,
  runGithubInstallationReconcileRoute,
} from "@/app/api/github/install/reconcile/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

/**
 * Reconciliation exists because GitHub never calls the Setup URL when the only
 * eligible account already has the App (#151). This route is the operator's own
 * entry into the authorization phase, so it must carry the same session gate and
 * the same PKCE cookie contract the callback already relies on.
 */
describe("GitHub App installation reconciliation entry route", () => {
  const authorizeLocation =
    "https://github.com/login/oauth/authorize?client_id=Iv1.loopworks&state=opaque";

  function recordingSpan() {
    return {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
    };
  }

  it("redirects an authenticated operator to GitHub and sets the PKCE cookie", async () => {
    const startReconciliation = vi.fn(async () => ({
      location: authorizeLocation,
      verifierCookie: "pkce-verifier",
    }));

    const response = await handleGithubInstallationReconcileStart(
      new Request("http://loopworks.local/api/github/install/reconcile"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        startReconciliation,
      },
    );

    expect(startReconciliation).toHaveBeenCalledWith({ actorId: "ncolesummers" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(authorizeLocation);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("loopworks-github-install-pkce=pkce-verifier");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toMatch(/SameSite=lax/i);
    // Over plain http the cookie must not claim Secure, or the browser drops it
    // and the callback finds no verifier.
    expect(cookie).not.toContain("Secure");
  });

  it("marks Secure on the PKCE cookie over https", async () => {
    const response = await handleGithubInstallationReconcileStart(
      new Request("https://loopworks.example/api/github/install/reconcile"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        startReconciliation: async () => ({
          location: authorizeLocation,
          verifierCookie: "pkce-verifier",
        }),
      },
    );

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("marks a successful start span with stable phase and outcome fields", async () => {
    const span = recordingSpan();

    await handleGithubInstallationReconcileStart(
      new Request("https://loopworks.local/api/github/install/reconcile"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        span: span as never,
        startReconciliation: async () => ({
          location: authorizeLocation,
          verifierCookie: "pkce-verifier",
        }),
      },
    );

    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.phase",
      "authorization",
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "started",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it("marks a caught start failure as an error without leaking the provider message", async () => {
    const span = recordingSpan();

    const response = await handleGithubInstallationReconcileStart(
      new Request("https://loopworks.local/api/github/install/reconcile"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        span: span as never,
        startReconciliation: async () => {
          throw new Error("sensitive provider failure");
        },
      },
    );

    expect(response.headers.get("location")).toBe("https://loopworks.local/settings?github=error");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("pkce");
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "error",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
  });

  it("refuses an unauthenticated operator without minting a challenge", async () => {
    const span = recordingSpan();
    const startReconciliation = vi.fn();

    const response = await handleGithubInstallationReconcileStart(
      new Request("https://loopworks.local/api/github/install/reconcile"),
      {
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
        span: span as never,
        startReconciliation,
      },
    );

    expect(response.status).toBe(401);
    expect(startReconciliation).not.toHaveBeenCalled();
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "unauthenticated",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
  });

  it("passes the owned route span into the start handler and ends it", async () => {
    const span = recordingSpan();
    const handleStart = vi.fn(async (_request: Request, dependencies?: { span?: unknown }) => {
      expect(dependencies?.span).toBe(span);
      return new Response(null, { status: 204 }) as never;
    });
    const withSpan = vi.fn(
      async (_name: string, callback: (ownedSpan: never) => Promise<unknown>) =>
        callback(span as never),
    );

    const response = await runGithubInstallationReconcileRoute(
      new Request("https://loopworks.local/api/github/install/reconcile"),
      { handleStart: handleStart as never, withSpan: withSpan as never },
    );

    expect(response.status).toBe(204);
    expect(withSpan).toHaveBeenCalledWith("github.installation.reconcile", expect.any(Function));
    expect(span.end).toHaveBeenCalledOnce();
  });
});
