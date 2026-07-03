import { trace } from "@opentelemetry/api";

const w3cTraceIdPattern = /^[0-9a-f]{32}$/;
const emptyTraceId = "00000000000000000000000000000000";

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
