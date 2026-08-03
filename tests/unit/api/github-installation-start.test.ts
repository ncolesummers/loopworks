/** @vitest-environment node */

import { SpanStatusCode } from "@opentelemetry/api";

import {
  handleGithubInstallationStart,
  runGithubInstallationStartRoute,
} from "@/app/api/github/install/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("GitHub App installation entry route", () => {
  function recordingSpan() {
    return {
      end: vi.fn(),
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
    };
  }

  it("requires the existing API session and redirects an operator to GitHub", async () => {
    const start = vi.fn(async () => ({
      location: "https://github.com/apps/loopworks-app/installations/new?state=opaque",
    }));
    const response = await handleGithubInstallationStart(
      new Request("https://loopworks.local/api/github/install"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        start,
      },
    );

    expect(start).toHaveBeenCalledWith({ actorId: "ncolesummers" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://github.com/apps/loopworks-app/installations/new?state=opaque",
    );
  });

  it("marks a successful start span with stable phase and outcome fields", async () => {
    const span = recordingSpan();
    await handleGithubInstallationStart(new Request("https://loopworks.local/api/github/install"), {
      requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
      span: span as never,
      start: async () => ({
        location: "https://github.com/apps/loopworks-app/installations/new?state=opaque",
      }),
    });

    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.phase",
      "installation",
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "started",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it("marks a caught start failure as an error without recording the exception", async () => {
    const span = recordingSpan();
    const response = await handleGithubInstallationStart(
      new Request("https://loopworks.local/api/github/install"),
      {
        requireSession: async () => ({ actorId: "ncolesummers", authenticated: true }),
        span: span as never,
        start: async () => {
          throw new Error("sensitive provider failure");
        },
      },
    );

    expect(response.headers.get("location")).toBe("https://loopworks.local/settings?github=error");
    expect(span.setAttribute).toHaveBeenCalledWith(
      "loopworks.github.installation.outcome",
      "error",
    );
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR });
    expect(span).not.toHaveProperty("recordException");
  });

  it("marks an authentication denial without reporting a successful start", async () => {
    const span = recordingSpan();
    const start = vi.fn();
    const response = await handleGithubInstallationStart(
      new Request("https://loopworks.local/api/github/install"),
      {
        requireSession: async () => ({
          authenticated: false,
          response: new Response("Authentication required", { status: 401 }) as never,
        }),
        span: span as never,
        start,
      },
    );

    expect(response.status).toBe(401);
    expect(start).not.toHaveBeenCalled();
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

    const response = await runGithubInstallationStartRoute(
      new Request("https://loopworks.local/api/github/install"),
      { handleStart: handleStart as never, withSpan: withSpan as never },
    );

    expect(response.status).toBe(204);
    expect(withSpan).toHaveBeenCalledWith("github.installation.start", expect.any(Function));
    expect(span.end).toHaveBeenCalledOnce();
  });
});
