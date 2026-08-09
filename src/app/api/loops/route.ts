import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/auth/api";
import type {
  LoopRegistrationFormInput,
  LoopRegistrationResult,
  LoopRegistrationSnapshot,
} from "@/lib/loops/loop-registration-flow";
import { createLoopRegistrationRuntime } from "@/lib/loops/loop-registration-runtime";
import { createRequestLogger } from "@/lib/observability/logger";
import { type LoopworksSpan, withLoopworksActiveSpan } from "@/lib/observability/trace-context";

const route = "api.loops";
const maxTriggerLabels = 20;
const maxFieldLength = 200;

/**
 * Upstream failure text can carry connection strings or provider detail. Only these coded reasons
 * are ever logged; anything else is reduced to `unexpected_error`.
 */
const loggableReasons = new Set([
  "catalog_unreachable",
  "loop_registration_failed",
  "store_unreachable",
]);

function safeReason(reason: string | undefined): string {
  return reason && loggableReasons.has(reason) ? reason : "unexpected_error";
}

type RegistrationSession =
  | { actorId: string; authenticated: true }
  | { authenticated: false; response: NextResponse };

type RegistrationDependencies = {
  readRegistration: () => Promise<LoopRegistrationSnapshot>;
  registerLoop: (input: LoopRegistrationFormInput) => Promise<LoopRegistrationResult>;
  requireSession: (input: { route: string }) => Promise<RegistrationSession>;
  span: LoopworksSpan;
};

function markOutcome(span: LoopworksSpan | undefined, outcome: string): void {
  span?.setAttribute("loopworks.loops.registration.outcome", outcome);
}

function boundedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > maxFieldLength ? null : trimmed;
}

function triggerLabelList(value: unknown): string[] | null {
  // An empty list is *valid input shape* and invalid manifest content, so it is deliberately not
  // rejected here: the operator must see the schema's field-level message, not a bare 400.
  if (!Array.isArray(value) || value.length > maxTriggerLabels) return null;
  const labels: string[] = [];
  for (const entry of value) {
    const label = boundedString(entry);
    if (label === null) return null;
    labels.push(label);
  }
  return labels;
}

function parseRegistrationForm(body: unknown): LoopRegistrationFormInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const payload = body as Record<string, unknown>;

  const key = boundedString(payload.key);
  const name = boundedString(payload.name);
  const repositoryId = boundedString(payload.repositoryId);
  const issueLabels = triggerLabelList(payload.issueLabels);
  const description =
    payload.description === undefined ? undefined : boundedString(payload.description);

  if (key === null || name === null || repositoryId === null || issueLabels === null) return null;
  if (typeof payload.enabled !== "boolean") return null;
  if (description === null) return null;

  return {
    enabled: payload.enabled,
    issueLabels,
    key,
    name,
    repositoryId,
    ...(description === undefined ? {} : { description }),
  };
}

export async function handleLoopRegistrationRead(
  _request: Request,
  dependencies: Partial<RegistrationDependencies> = {},
): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route });
  const session = await (dependencies.requireSession ?? requireApiSession)({ route });
  if (!session.authenticated) {
    markOutcome(dependencies.span, "unauthenticated");
    return session.response;
  }

  let snapshot: LoopRegistrationSnapshot;
  try {
    // Runtime construction reads configuration and can throw; a misconfigured deployment must not
    // surface as an unhandled 500.
    snapshot = await (
      dependencies.readRegistration ?? (() => createLoopRegistrationRuntime().readRegistration())
    )();
  } catch (error) {
    markOutcome(dependencies.span, "error");
    requestLogger.warn(
      { outcome: "error", reason: safeReason(error instanceof Error ? error.message : undefined) },
      "loop_registration_read_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  markOutcome(dependencies.span, snapshot.status);

  if (snapshot.status === "error") {
    requestLogger.warn(
      { outcome: "error", reason: safeReason(snapshot.reason) },
      "loop_registration_read_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }

  return NextResponse.json(snapshot);
}

export async function handleLoopRegistrationApply(
  request: Request,
  dependencies: Partial<RegistrationDependencies> = {},
): Promise<NextResponse> {
  const requestLogger = createRequestLogger({ route });
  const session = await (dependencies.requireSession ?? requireApiSession)({ route });
  if (!session.authenticated) {
    markOutcome(dependencies.span, "unauthenticated");
    return session.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    markOutcome(dependencies.span, "invalid-request");
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }

  const form = parseRegistrationForm(body);
  if (!form) {
    markOutcome(dependencies.span, "invalid-request");
    return NextResponse.json({ status: "invalid-request" }, { status: 400 });
  }

  let result: LoopRegistrationResult;
  try {
    result = await (
      dependencies.registerLoop ??
      ((input: LoopRegistrationFormInput) => createLoopRegistrationRuntime().registerLoop(input))
    )(form);
  } catch (error) {
    markOutcome(dependencies.span, "error");
    requestLogger.warn(
      { outcome: "error", reason: safeReason(error instanceof Error ? error.message : undefined) },
      "loop_registration_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  markOutcome(dependencies.span, result.status);

  if (result.status === "error") {
    requestLogger.warn(
      { outcome: "error", reason: safeReason(result.reason) },
      "loop_registration_failed",
    );
    return NextResponse.json({ status: "error" }, { status: 502 });
  }

  if (result.status === "invalid") {
    // Field paths and hints are schema-derived and operator-facing; they carry no upstream detail.
    return NextResponse.json({ errors: result.errors, status: "invalid" }, { status: 400 });
  }

  if (result.status === "duplicate-key") {
    return NextResponse.json({ status: "duplicate-key" }, { status: 409 });
  }

  if (result.status === "repository-missing") {
    return NextResponse.json({ status: "repository-missing" }, { status: 422 });
  }

  createRequestLogger({ actorId: session.actorId, route }).info(
    {
      loopKey: result.loopKey,
      outcome: result.status,
      repositoryId: form.repositoryId,
    },
    "loop_registration_applied",
  );
  return NextResponse.json({ loopKey: result.loopKey, status: result.status }, { status: 201 });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withLoopworksActiveSpan("loops.registration.read", async (span) => {
    try {
      return await handleLoopRegistrationRead(request, { span });
    } finally {
      span.end();
    }
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return withLoopworksActiveSpan("loops.registration.apply", async (span) => {
    try {
      return await handleLoopRegistrationApply(request, { span });
    } finally {
      span.end();
    }
  });
}
