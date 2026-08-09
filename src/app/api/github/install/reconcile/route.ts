import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import { setGithubInstallationPkceCookie } from "@/lib/github/installation-pkce-cookie";
import { createGithubInstallationRuntime } from "@/lib/github/installation-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { recordGithubInstallationFlowOutcomeMetric } from "@/lib/observability/metrics";
import {
  type LoopworksSpan,
  markGithubInstallationSpanOutcome,
  withLoopworksActiveSpan,
} from "@/lib/observability/trace-context";

/**
 * GitHub only installs from `/apps/<slug>/installations/new` when an eligible
 * target lacks the App. When the only eligible account already has it, GitHub
 * short-circuits to the configure page and never calls the Setup URL, so the
 * installation phase can never run and `/settings` dead-ends on "Not connected"
 * (#151). This route is the operator's own entry into the authorization phase:
 * it mints an authorization challenge with no candidate installation, which the
 * shared callback reads as a reconciliation.
 */
type ReconcileSession =
  | { authenticated: true; actorId: string }
  | { authenticated: false; response: NextResponse };

type GithubInstallationReconcileDependencies = {
  requireSession: (input: { route: string }) => Promise<ReconcileSession>;
  span: LoopworksSpan;
  startReconciliation: (input: {
    actorId: string;
  }) => Promise<{ location: string; verifierCookie: string }>;
};

type GithubInstallationReconcileRouteDependencies = {
  handleStart: typeof handleGithubInstallationReconcileStart;
  withSpan: typeof withLoopworksActiveSpan;
};

export async function handleGithubInstallationReconcileStart(
  request: Request,
  dependencies: Partial<GithubInstallationReconcileDependencies> = {},
): Promise<NextResponse> {
  // The operator returns through the shared OAuth callback, which reports this
  // phase, so the start reports it too.
  const phase = "authorization" as const;
  const requestLogger = createRequestLogger({ route: "api.github.install.reconcile" });

  try {
    const session = await (dependencies.requireSession ?? requireApiSession)({
      route: "api.github.install.reconcile",
    });
    if (!session.authenticated) {
      markGithubInstallationSpanOutcome(dependencies.span, {
        outcome: "unauthenticated",
        phase,
      });
      return session.response;
    }

    const result = await (
      dependencies.startReconciliation ?? createGithubInstallationRuntime().startReconciliation
    )({ actorId: session.actorId });
    recordGithubInstallationFlowOutcomeMetric({ outcome: "started", phase });
    createRequestLogger({ route: "api.github.install.reconcile", actorId: session.actorId }).info(
      { outcome: "started", phase },
      "github_installation_reconcile_started",
    );
    markGithubInstallationSpanOutcome(dependencies.span, { outcome: "started", phase });
    return setGithubInstallationPkceCookie(NextResponse.redirect(result.location), {
      requestUrl: request.url,
      verifier: result.verifierCookie,
    });
  } catch {
    recordGithubInstallationFlowOutcomeMetric({ outcome: "error", phase });
    requestLogger.warn({ outcome: "error", phase }, "github_installation_reconcile_start_failed");
    markGithubInstallationSpanOutcome(dependencies.span, { outcome: "error", phase });
    return NextResponse.redirect(new URL("/settings?github=error", request.url));
  }
}

export async function runGithubInstallationReconcileRoute(
  request: Request,
  dependencies: Partial<GithubInstallationReconcileRouteDependencies> = {},
): Promise<NextResponse> {
  return (dependencies.withSpan ?? withLoopworksActiveSpan)(
    "github.installation.reconcile",
    async (span) => {
      try {
        return await (dependencies.handleStart ?? handleGithubInstallationReconcileStart)(request, {
          span,
        });
      } finally {
        span.end();
      }
    },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return runGithubInstallationReconcileRoute(request);
}
