import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { createGithubInstallationRuntime } from "@/lib/github/installation-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { recordGithubInstallationFlowOutcomeMetric } from "@/lib/observability/metrics";
import { withLoopworksActiveSpan } from "@/lib/observability/trace-context";

type StartSession =
  | { authenticated: true; actorId: string }
  | { authenticated: false; response: NextResponse };

type GithubInstallationStartDependencies = {
  requireSession: (input: { route: string }) => Promise<StartSession>;
  start: (input: { actorId: string }) => Promise<{ location: string }>;
};

export async function handleGithubInstallationStart(
  _request: Request,
  dependencies: Partial<GithubInstallationStartDependencies> = {},
): Promise<NextResponse> {
  const session = await (dependencies.requireSession ?? requireApiSession)({
    route: "api.github.install",
  });
  if (!session.authenticated) return session.response;

  const result = await (dependencies.start ?? createGithubInstallationRuntime().start)({
    actorId: session.actorId,
  });
  recordGithubInstallationFlowOutcomeMetric({ outcome: "started", phase: "installation" });
  createRequestLogger({ route: "api.github.install", actorId: session.actorId }).info(
    { outcome: "started", phase: "installation" },
    "github_installation_started",
  );
  return NextResponse.redirect(result.location);
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route: "api.github.install" });
  return withLoopworksActiveSpan("github.installation.start", async (span) => {
    try {
      return await handleGithubInstallationStart(request);
    } catch {
      recordGithubInstallationFlowOutcomeMetric({ outcome: "error", phase: "installation" });
      requestLogger.warn({ outcome: "error" }, "github_installation_start_failed");
      return NextResponse.redirect(new URL("/settings?github=error", request.url));
    } finally {
      span.end();
    }
  });
}
