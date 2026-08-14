import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import type {
  GithubInstallationCallbackInput,
  GithubInstallationCallbackResult,
} from "@/lib/github/installation-flow";
import {
  clearGithubInstallationPkceCookie,
  readGithubInstallationPkceCookie,
  setGithubInstallationPkceCookie,
} from "@/lib/github/installation-pkce-cookie";
import { createGithubInstallationRuntime } from "@/lib/github/installation-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { recordGithubInstallationFlowOutcomeMetric } from "@/lib/observability/metrics";
import {
  type LoopworksSpan,
  markGithubInstallationSpanOutcome,
  withLoopworksActiveSpan,
} from "@/lib/observability/trace-context";

type CallbackSession =
  | {
      authenticated: true;
      actorId: string;
      githubProviderAccountId: string | null;
      mode: "github" | "fixture";
    }
  | { authenticated: false; response: NextResponse };

type GithubInstallationCallbackDependencies = {
  processCallback: (
    input: GithubInstallationCallbackInput,
  ) => Promise<GithubInstallationCallbackResult>;
  requireSession: (input: { route: string }) => Promise<CallbackSession>;
  span: LoopworksSpan;
};

type GithubInstallationCallbackRouteDependencies = {
  handleCallback: typeof handleGithubInstallationCallback;
  withSpan: typeof withLoopworksActiveSpan;
};

export function getGithubInstallationCallbackPhase(
  request: Request,
): "authorization" | "installation" {
  const url = new URL(request.url);
  return url.searchParams.get("code") || url.searchParams.get("error")
    ? "authorization"
    : "installation";
}

export async function handleGithubInstallationCallback(
  request: Request,
  dependencies: Partial<GithubInstallationCallbackDependencies> = {},
): Promise<NextResponse> {
  const phase = getGithubInstallationCallbackPhase(request);
  const requestLogger = createRequestLogger({ route: "api.github.install.callback" });

  try {
    const session = await (dependencies.requireSession ?? requireApiSession)({
      route: "api.github.install.callback",
    });
    if (!session.authenticated) {
      markGithubInstallationSpanOutcome(dependencies.span, {
        outcome: "unauthenticated",
        phase,
      });
      return session.response;
    }
    if (session.mode === "github" && !session.githubProviderAccountId) {
      throw new Error("github_session_provider_account_id_missing");
    }

    const url = new URL(request.url);
    const result = await (
      dependencies.processCallback ?? createGithubInstallationRuntime().callback
    )({
      actorId: session.actorId,
      authorizationCode: url.searchParams.get("code"),
      error: url.searchParams.get("error"),
      githubProviderAccountId: session.githubProviderAccountId,
      installationId: url.searchParams.get("installation_id"),
      mode: session.mode,
      pkceVerifier: readGithubInstallationPkceCookie(request),
      setupAction: url.searchParams.get("setup_action"),
      githubInstallationState: url.searchParams.get("state"),
    });

    if (result.kind === "authorize") {
      const authorizationPhase = "installation" as const;
      recordGithubInstallationFlowOutcomeMetric({
        outcome: "authorize",
        phase: authorizationPhase,
      });
      createRequestLogger({ route: "api.github.install.callback", actorId: session.actorId }).info(
        { outcome: "authorize", phase: authorizationPhase },
        "github_installation_callback_processed",
      );
      markGithubInstallationSpanOutcome(dependencies.span, {
        outcome: "authorize",
        phase: authorizationPhase,
      });
      return setGithubInstallationPkceCookie(NextResponse.redirect(result.location), {
        requestUrl: request.url,
        verifier: result.verifierCookie,
      });
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
    markGithubInstallationSpanOutcome(dependencies.span, {
      outcome: result.outcome,
      phase,
    });

    return clearGithubInstallationPkceCookie(
      NextResponse.redirect(new URL(`/settings?github=${result.outcome}`, request.url)),
    );
  } catch {
    recordGithubInstallationFlowOutcomeMetric({ outcome: "error", phase });
    requestLogger.warn({ outcome: "error", phase }, "github_installation_callback_failed");
    markGithubInstallationSpanOutcome(dependencies.span, { outcome: "error", phase });
    return NextResponse.redirect(new URL("/settings?github=error", request.url));
  }
}

export async function runGithubInstallationCallbackRoute(
  request: Request,
  dependencies: Partial<GithubInstallationCallbackRouteDependencies> = {},
): Promise<NextResponse> {
  return (dependencies.withSpan ?? withLoopworksActiveSpan)(
    "github.installation.callback",
    async (span) => {
      try {
        return await (dependencies.handleCallback ?? handleGithubInstallationCallback)(request, {
          span,
        });
      } finally {
        span.end();
      }
    },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return runGithubInstallationCallbackRoute(request);
}
