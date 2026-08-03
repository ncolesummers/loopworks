/** @vitest-environment node */
import { type Context, type Span, type Tracer, trace } from "@opentelemetry/api";

import {
  startDevelopmentLoopDispatchSpan,
  startDevelopmentLoopRetrySpan,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";

describe("Loopworks trace context helpers", () => {
  it("starts spans through the centralized Loopworks tracer helper", () => {
    const span = { end: vi.fn() } as unknown as Span;
    const starts: { name: string; options: unknown }[] = [];
    const tracer = {
      startSpan(name: string, options?: unknown) {
        starts.push({ name, options });
        return span;
      },
    } as unknown as Tracer;

    expect(
      startLoopworksSpan(
        "loopworks.test.span",
        {
          attributes: {
            "loopworks.run.id": "run_123",
          },
        },
        tracer,
      ),
    ).toBe(span);
    expect(starts).toEqual([
      {
        name: "loopworks.test.span",
        options: {
          attributes: {
            "loopworks.run.id": "run_123",
          },
        },
      },
    ]);
  });

  it("owns stable dispatch and retry span contracts centrally", () => {
    const span = { setAttribute: vi.fn() } as unknown as Span;
    const names: string[] = [];
    const tracer = {
      startSpan(name: string) {
        names.push(name);
        return span;
      },
    } as unknown as Tracer;

    startDevelopmentLoopDispatchSpan(tracer).setOutcome("deferred");
    startDevelopmentLoopRetrySpan(tracer).setOutcome("scheduled");

    expect(names).toEqual(["loopworks.run.dispatch", "loopworks.run.retry"]);
    expect(span.setAttribute).toHaveBeenNthCalledWith(1, "loopworks.dispatch.outcome", "deferred");
    expect(span.setAttribute).toHaveBeenNthCalledWith(2, "loopworks.retry.outcome", "scheduled");
  });

  it("binds dispatch and retry spans to a supplied durable trace id", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const span = { setAttribute: vi.fn() } as unknown as Span;
    const parents: Context[] = [];
    const tracer = {
      startSpan(_name: string, _options?: unknown, parent?: Context) {
        if (parent) parents.push(parent);
        return span;
      },
    } as unknown as Tracer;

    startDevelopmentLoopDispatchSpan({ traceId, tracer });
    startDevelopmentLoopRetrySpan({ traceId, tracer });

    expect(parents.map((parent) => trace.getSpanContext(parent)?.traceId)).toEqual([
      traceId,
      traceId,
    ]);
  });
});
