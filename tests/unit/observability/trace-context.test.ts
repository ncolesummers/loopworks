/** @vitest-environment node */
import type { Span, Tracer } from "@opentelemetry/api";

import { startLoopworksSpan } from "@/lib/observability/trace-context";

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
});
