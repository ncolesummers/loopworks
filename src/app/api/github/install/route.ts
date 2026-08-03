import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { createGithubInstallationRuntime } from "@/lib/github/installation-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { recordGithubInstallationFlowOutcomeMetric } from "@/lib/observability/metrics";
import {
  type LoopworksSpan,
  markGithubInstallationSpanOutcome,
  withLoopworksActiveSpan,
} from "@/lib/observability/trace-context";

type StartSession =
  | { authenticated: true; actorId: string }
  | { authenticated: false; response: NextResponse };

type GithubInstallationStartDependencies = {
  requireSession: (input: { route: string }) => Promise<StartSession>;
  span: LoopworksSpan;
  start: (input: { actorId: string }) => Promise<{ location: string }>;
};

type GithubInstallationStartRouteDependencies = {
  handleStart: typeof handleGithubInstallationStart;
  withSpan: typeof withLoopworksActiveSpan;
};

export async function handleGithubInstallationStart(
  _request: Request,
  dependencies: Partial<GithubInstallationStartDependencies> = {},
): Promise<NextResponse> {
  const phase = "installation" as const;
  const requestLogger = createRequestLogger({ route: "api.github.install" });

  try {
    const session = await (dependencies.requireSession ?? requireApiSession)({
      route: "api.github.install",
    });
    if (!session.authenticated) {
      markGithubInstallationSpanOutcome(dependencies.span, {
        outcome: "unauthenticated",
        phase,
      });
      return session.response;
    }

    const result = await (dependencies.start ?? createGithubInstallationRuntime().start)({
      actorId: session.actorId,
    });
    recordGithubInstallationFlowOutcomeMetric({ outcome: "started", phase });
    createRequestLogger({ route: "api.github.install", actorId: session.actorId }).info(
      { outcome: "started", phase },
      "github_installation_started",
    );
    markGithubInstallationSpanOutcome(dependencies.span, { outcome: "started", phase });
    return NextResponse.redirect(result.location);
  } catch {
    recordGithubInstallationFlowOutcomeMetric({ outcome: "error", phase });
    requestLogger.warn({ outcome: "error", phase }, "github_installation_start_failed");
    markGithubInstallationSpanOutcome(dependencies.span, { outcome: "error", phase });
    return NextResponse.redirect(new URL("/settings?github=error", _request.url));
  }
}

export async function runGithubInstallationStartRoute(
  request: Request,
  dependencies: Partial<GithubInstallationStartRouteDependencies> = {},
): Promise<NextResponse> {
  return (dependencies.withSpan ?? withLoopworksActiveSpan)(
    "github.installation.start",
    async (span) => {
      try {
        return await (dependencies.handleStart ?? handleGithubInstallationStart)(request, { span });
      } finally {
        span.end();
      }
    },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return runGithubInstallationStartRoute(request);
}
