import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import type {
  GithubInstallationCallbackInput,
  GithubInstallationCallbackResult,
} from "@/lib/github/installation-flow";
import { createGithubInstallationRuntime } from "@/lib/github/installation-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { recordGithubInstallationFlowOutcomeMetric } from "@/lib/observability/metrics";
import { withLoopworksActiveSpan } from "@/lib/observability/trace-context";

const pkceCookieName = "loopworks-github-install-pkce";

type CallbackSession =
  | { authenticated: true; actorId: string }
  | { authenticated: false; response: NextResponse };

type GithubInstallationCallbackDependencies = {
  processCallback: (
    input: GithubInstallationCallbackInput,
  ) => Promise<GithubInstallationCallbackResult>;
  requireSession: (input: { route: string }) => Promise<CallbackSession>;
};

export function getGithubInstallationCallbackPhase(
  request: Request,
): "authorization" | "installation" {
  const url = new URL(request.url);
  return url.searchParams.has("code") || url.searchParams.has("error")
    ? "authorization"
    : "installation";
}

export async function handleGithubInstallationCallback(
  request: Request,
  dependencies: Partial<GithubInstallationCallbackDependencies> = {},
): Promise<NextResponse> {
  const session = await (dependencies.requireSession ?? requireApiSession)({
    route: "api.github.install.callback",
  });
  if (!session.authenticated) return session.response;

  const url = new URL(request.url);
  const phase = getGithubInstallationCallbackPhase(request);
  const result = await (dependencies.processCallback ?? createGithubInstallationRuntime().callback)(
    {
      actorId: session.actorId,
      authorizationCode: url.searchParams.get("code"),
      error: url.searchParams.get("error"),
      installationId: url.searchParams.get("installation_id"),
      pkceVerifier: request.headers
        .get("cookie")
        ?.match(new RegExp(`(?:^|;\\s*)${pkceCookieName}=([^;]+)`))?.[1]
        ? decodeURIComponent(
            request.headers
              .get("cookie")
              ?.match(new RegExp(`(?:^|;\\s*)${pkceCookieName}=([^;]+)`))?.[1] ?? "",
          )
        : null,
      setupAction: url.searchParams.get("setup_action"),
      githubInstallationState: url.searchParams.get("state"),
    },
  );

  if (result.kind === "authorize") {
    recordGithubInstallationFlowOutcomeMetric({ outcome: "authorize", phase: "installation" });
    createRequestLogger({ route: "api.github.install.callback", actorId: session.actorId }).info(
      { outcome: "authorize", phase: "installation" },
      "github_installation_callback_processed",
    );
    const response = NextResponse.redirect(result.location);
    response.cookies.set(pkceCookieName, result.verifierCookie, {
      httpOnly: true,
      maxAge: 10 * 60,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
    });
    return response;
  }

  recordGithubInstallationFlowOutcomeMetric({
    outcome: result.outcome,
    phase,
  });
  createRequestLogger({ route: "api.github.install.callback", actorId: session.actorId }).info(
    {
      outcome: result.outcome,
      phase,
    },
    "github_installation_callback_processed",
  );

  const response = NextResponse.redirect(
    new URL(`/settings?github=${result.outcome}`, request.url),
  );
  response.cookies.delete(pkceCookieName);
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route: "api.github.install.callback" });
  const phase = getGithubInstallationCallbackPhase(request);
  return withLoopworksActiveSpan("github.installation.callback", async (span) => {
    try {
      return await handleGithubInstallationCallback(request);
    } catch {
      recordGithubInstallationFlowOutcomeMetric({ outcome: "error", phase });
      requestLogger.warn({ outcome: "error", phase }, "github_installation_callback_failed");
      return NextResponse.redirect(new URL("/settings?github=error", request.url));
    } finally {
      span.end();
    }
  });
}
