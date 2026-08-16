/** @vitest-environment node */
import { type Context, type Span, type Tracer, trace } from "@opentelemetry/api";

import {
  markGithubRepositorySelectionAuthorizationSpanOutcome,
  markGithubWebhookActivationSpanOutcome,
  startDevelopmentLoopDispatchSpan,
  startDevelopmentLoopRetrySpan,
  startLoopworksSpan,
} from "@/lib/observability/trace-context";

describe("Loopworks trace context helpers", () => {
  it("records only bounded repository-selection authorization attributes on spans", () => {
    const span = { setAttribute: vi.fn(), setStatus: vi.fn() } as unknown as Span;

    markGithubRepositorySelectionAuthorizationSpanOutcome(
      {
        accessToken: "ghu_span_canary",
        authorizationCacheKey: "22808397:124:124001",
        cacheHit: false,
        githubProviderAccountId: "22808397",
        operation: "read",
        outcome: "indeterminate",
      } as never,
      span,
    );

    expect(span.setAttribute).toHaveBeenCalledTimes(3);
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      1,
      "loopworks.github.repository_selection.operation",
      "read",
    );
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      2,
      "loopworks.github.repository_selection.authorization_outcome",
      "indeterminate",
    );
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      3,
      "loopworks.github.repository_selection.cache_hit",
      false,
    );
    expect(
      JSON.stringify((span.setAttribute as ReturnType<typeof vi.fn>).mock.calls),
    ).not.toContain("ghu_span_canary");
    expect(span.setStatus).toHaveBeenCalledWith({ code: 2 });
  });

  it("records bounded GitHub webhook activation outcomes on spans", () => {
    const span = { setAttribute: vi.fn(), setStatus: vi.fn() } as unknown as Span;

    markGithubWebhookActivationSpanOutcome({ action: "labeled", outcome: "authorized" }, span);
    markGithubWebhookActivationSpanOutcome(
      { action: "milestoned", outcome: "indeterminate" },
      span,
    );

    expect(span.setAttribute).toHaveBeenNthCalledWith(
      1,
      "loopworks.github.webhook.action",
      "labeled",
    );
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      2,
      "loopworks.github.webhook.outcome",
      "authorized",
    );
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      3,
      "loopworks.github.webhook.action",
      "milestoned",
    );
    expect(span.setAttribute).toHaveBeenNthCalledWith(
      4,
      "loopworks.github.webhook.outcome",
      "indeterminate",
    );
    expect(span.setStatus).toHaveBeenNthCalledWith(1, { code: 1 });
    expect(span.setStatus).toHaveBeenNthCalledWith(2, { code: 2 });
  });

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
