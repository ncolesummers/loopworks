import { randomBytes } from "node:crypto";
import {
  context,
  type Span,
  type SpanOptions,
  SpanStatusCode,
  TraceFlags,
  type Tracer,
  trace,
} from "@opentelemetry/api";

const w3cTraceIdPattern = /^[0-9a-f]{32}$/;
const emptyTraceId = "00000000000000000000000000000000";
const loopworksTracerName = "loopworks";

export type LoopworksSpan = Span;

export function getLoopworksTracer(): Tracer {
  return trace.getTracer(loopworksTracerName);
}

export function startLoopworksSpan(
  name: string,
  options?: SpanOptions,
  tracer = getLoopworksTracer(),
): Span {
  return tracer.startSpan(name, options);
}

export function withLoopworksActiveSpan<T>(
  name: string,
  callback: (span: Span) => Promise<T>,
  tracer = getLoopworksTracer(),
): Promise<T> {
  return tracer.startActiveSpan(name, callback);
}

export function startDevelopmentLoopReconciliationSpan(tracer = getLoopworksTracer()): {
  setRunCount(count: number): void;
  span: Span;
} {
  const span = startLoopworksSpan("loopworks.run.reconcile", undefined, tracer);
  return {
    setRunCount(count) {
      span.setAttribute("loopworks.run.count", count);
    },
    span,
  };
}

type DurableTraceSpanInput = {
  traceId?: string;
  tracer?: Tracer;
};

function startDurableTraceSpan(name: string, input: DurableTraceSpanInput): Span {
  const tracer = input.tracer ?? getLoopworksTracer();
  if (!input.traceId || !isValidW3cTraceId(input.traceId)) {
    return startLoopworksSpan(name, undefined, tracer);
  }
  const activeContext = context.active();
  const activeSpanContext = trace.getSpanContext(activeContext);
  const parentContext =
    activeSpanContext?.traceId === input.traceId
      ? activeContext
      : trace.setSpanContext(activeContext, {
          isRemote: true,
          spanId: randomBytes(8).toString("hex"),
          traceFlags: TraceFlags.SAMPLED,
          traceId: input.traceId,
        });
  return tracer.startSpan(name, undefined, parentContext);
}

export function startDevelopmentLoopDispatchSpan(input: DurableTraceSpanInput | Tracer = {}): {
  setOutcome(outcome: "deferred" | "dispatched" | "lease_contention"): void;
  span: Span;
} {
  const options = "startSpan" in input ? { tracer: input } : input;
  const span = startDurableTraceSpan("loopworks.run.dispatch", options);
  return {
    setOutcome(outcome) {
      span.setAttribute("loopworks.dispatch.outcome", outcome);
    },
    span,
  };
}

export function startDevelopmentLoopRetrySpan(input: DurableTraceSpanInput | Tracer = {}): {
  setOutcome(outcome: "exhausted" | "ineligible" | "promoted" | "scheduled"): void;
  span: Span;
} {
  const options = "startSpan" in input ? { tracer: input } : input;
  const span = startDurableTraceSpan("loopworks.run.retry", options);
  return {
    setOutcome(outcome) {
      span.setAttribute("loopworks.retry.outcome", outcome);
    },
    span,
  };
}

export function markLoopworksSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
}

export function markLoopworksSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
}

export function markGithubInstallationSpanOutcome(
  span: Span | undefined,
  input: { outcome: string; phase: "authorization" | "installation" },
): void {
  if (!span) return;

  span.setAttribute("loopworks.github.installation.phase", input.phase);
  span.setAttribute("loopworks.github.installation.outcome", input.outcome);
  span.setStatus({
    code:
      input.outcome === "error" || input.outcome === "unauthenticated"
        ? SpanStatusCode.ERROR
        : SpanStatusCode.OK,
  });
}

export function isValidW3cTraceId(traceId: unknown): traceId is string {
  return typeof traceId === "string" && w3cTraceIdPattern.test(traceId) && traceId !== emptyTraceId;
}

export function getActiveTraceId(): string | undefined {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  return isValidW3cTraceId(traceId) ? traceId : undefined;
}

export function withActiveTraceId<T extends Record<string, unknown>>(
  fields: T,
  traceId = getActiveTraceId(),
): T & { traceId?: string } {
  if (!traceId) {
    return fields;
  }

  return {
    ...fields,
    traceId,
  };
}
