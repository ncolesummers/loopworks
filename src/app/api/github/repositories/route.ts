import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import {
  type RepositorySelectionAuthorizationSubject,
  readRepositorySelectionAuthorizationSubject,
} from "@/lib/auth/repository-selection-subject";
import type {
  RepositorySelectionApplyResult,
  RepositorySelectionSnapshot,
} from "@/lib/github/repository-selection";
import { createGithubRepositorySelectionRuntime } from "@/lib/github/repository-selection-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { observeGithubRepositorySelectionAuthorization } from "@/lib/observability/repository-selection";
import { type LoopworksSpan, withLoopworksActiveSpan } from "@/lib/observability/trace-context";

const route = "api.github.repositories";
const maxRepositoriesPerRequest = 500;

/**
 * Upstream failure text can carry provider detail, tokens, or account names. Only these coded
 * reasons are ever logged; anything else is reduced to `unexpected_error`.
 */
const loggableReasons = new Set([
  "github_installation_configuration_invalid",
  "github_installation_token_failed",
  "github_repository_selection_failed",
  "github_repository_verification_failed",
  "github_repository_selection_authorization_indeterminate",
]);

function safeReason(reason: string | undefined): string {
  return reason && loggableReasons.has(reason) ? reason : "unexpected_error";
}

type SelectionSession =
  | {
      authenticated: true;
      actorId: string;
      authorizationSubject?: RepositorySelectionAuthorizationSubject | null;
      session?: import("next-auth").Session | null;
    }
  | { authenticated: false; response: NextResponse };

type SelectionDependencies = {
  applySelection: (
    input: {
      authUserId: string;
      githubProviderAccountId: string;
    },
    selection: {
      deselect: number[];
      select: number[];
    },
  ) => Promise<RepositorySelectionApplyResult>;
  readSelection: (
    subject: RepositorySelectionAuthorizationSubject,
  ) => Promise<RepositorySelectionSnapshot>;
  requireSession: (input: { route: string }) => Promise<SelectionSession>;
  span: LoopworksSpan;
};

function authorizationSubjectFromSession(
  session: Extract<SelectionSession, { authenticated: true }>,
): RepositorySelectionAuthorizationSubject | null {
  if ("authorizationSubject" in session) return session.authorizationSubject ?? null;
  return readRepositorySelectionAuthorizationSubject(session.session ?? null);
}

function markOutcome(span: LoopworksSpan | undefined, outcome: string): void {
  span?.setAttribute("loopworks.github.repository_selection.outcome", outcome);
}

function repositoryIdList(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxRepositoriesPerRequest) return null;
  const ids = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry <= 0) return null;
    // A duplicate id would be applied twice and reported twice; reject rather than silently dedupe.
    if (ids.has(entry)) return null;
    ids.add(entry);
  }
  return [...ids];
}

export async function handleGithubRepositorySelectionRead(
  _request: Request,
  dependencies: Partial<SelectionDependencies> = {},
): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route });
  const session = await (dependencies.requireSession ?? requireApiSession)({ route });
  if (!session.authenticated) {
    markOutcome(dependencies.span, "unauthenticated");
    return session.response;
  }
  const authorizationSubject = authorizationSubjectFromSession(session);
  if (!authorizationSubject) {
    markOutcome(dependencies.span, "error");
    observeGithubRepositorySelectionAuthorization({
      cacheHit: false,
      operation: "read",
      outcome: "indeterminate",
    });
    return NextResponse.json({ status: "error" }, { status: 502 });
  }

  let snapshot: RepositorySelectionSnapshot;
  try {
    // Runtime construction reads configuration and can throw; a misconfigured deployment must not
    // surface as an unhandled 500.
    snapshot = await (
      dependencies.readSelection ??
      ((subject: RepositorySelectionAuthorizationSubject) =>
        createGithubRepositorySelectionRuntime().readSelection(subject))
    )(authorizationSubject);
  } catch (error) {
    markOutcome(dependencies.span, "error");
    requestLogger.warn(
      { outcome: "error", reason: safeReason(error instanceof Error ? error.message : undefined) },
      "github_repository_selection_read_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  markOutcome(dependencies.span, snapshot.status);

  if (snapshot.status === "access-denied") {
    return NextResponse.json({ status: "access-denied" }, { status: 403 });
  }

  if (snapshot.status === "error") {
    requestLogger.warn(
      { outcome: "error", reason: safeReason(snapshot.reason) },
      "github_repository_selection_read_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }

  return NextResponse.json(snapshot);
}

export async function handleGithubRepositorySelectionApply(
  request: Request,
  dependencies: Partial<SelectionDependencies> = {},
): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route });
  const session = await (dependencies.requireSession ?? requireApiSession)({ route });
  if (!session.authenticated) {
    markOutcome(dependencies.span, "unauthenticated");
    return session.response;
  }
  const authorizationSubject = authorizationSubjectFromSession(session);
  if (!authorizationSubject) {
    markOutcome(dependencies.span, "error");
    observeGithubRepositorySelectionAuthorization({
      cacheHit: false,
      operation: "apply",
      outcome: "indeterminate",
    });
    return NextResponse.json({ status: "error" }, { status: 502 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    markOutcome(dependencies.span, "invalid-request");
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }

  const payload =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const select = repositoryIdList(payload?.select);
  const deselect = repositoryIdList(payload?.deselect);
  const overlaps =
    select && deselect && select.some((githubRepoId) => deselect.includes(githubRepoId));
  if (!payload || !select || !deselect || overlaps) {
    markOutcome(dependencies.span, "invalid-request");
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }

  let result: RepositorySelectionApplyResult;
  try {
    result = await (
      dependencies.applySelection ??
      ((
        subject: RepositorySelectionAuthorizationSubject,
        input: { deselect: number[]; select: number[] },
      ) => createGithubRepositorySelectionRuntime().applySelection(subject, input))
    )(authorizationSubject, { deselect, select });
  } catch (error) {
    markOutcome(dependencies.span, "error");
    requestLogger.warn(
      { outcome: "error", reason: safeReason(error instanceof Error ? error.message : undefined) },
      "github_repository_selection_apply_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  markOutcome(dependencies.span, result.status);

  if (result.status === "access-denied") {
    return NextResponse.json({ status: "access-denied" }, { status: 403 });
  }

  if (result.status === "error") {
    requestLogger.warn(
      { outcome: "error", reason: safeReason(result.reason) },
      "github_repository_selection_apply_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  if (result.status === "not-connected") {
    return NextResponse.json({ status: "not-connected" }, { status: 409 });
  }

  createRequestLogger({ actorId: session.actorId, route }).info(
    {
      outcome: result.status,
      // Ids and per-repository outcomes are the audit record for a destructive action.
      repositories: result.outcomes,
      ...(result.status === "partial" ? { reason: safeReason(result.reason) } : {}),
    },
    "github_repository_selection_applied",
  );
  return NextResponse.json(
    { outcomes: result.outcomes, status: result.status },
    { status: result.status === "partial" ? 207 : 200 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  return withLoopworksActiveSpan("github.repository_selection.read", async (span) => {
    try {
      return await handleGithubRepositorySelectionRead(request, { span });
    } finally {
      span.end();
    }
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return withLoopworksActiveSpan("github.repository_selection.apply", async (span) => {
    try {
      return await handleGithubRepositorySelectionApply(request, { span });
    } finally {
      span.end();
    }
  });
}
