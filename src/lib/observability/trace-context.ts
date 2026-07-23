import {
  type Span,
  type SpanOptions,
  SpanStatusCode,
  type Tracer,
  trace,
} from "@opentelemetry/api";

const w3cTraceIdPattern = /^[0-9a-f]{32}$/;
const emptyTraceId = "00000000000000000000000000000000";
const loopworksTracerName = "loopworks";

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

export function markLoopworksSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
}

export function markLoopworksSpanError(span: Span, error: unknown): void {
  span.recordException(error instanceof Error ? error : String(error));
  span.setStatus({ code: SpanStatusCode.ERROR });
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
