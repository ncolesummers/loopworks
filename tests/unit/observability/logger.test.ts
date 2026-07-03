import { createLogger } from "@/lib/observability/logger";
import { context, trace, TraceFlags, type Span } from "@opentelemetry/api";

function createMemoryDestination() {
  const writes: string[] = [];

  return {
    writes,
    destination: {
      write(chunk: string) {
        writes.push(chunk);
      },
    },
  };
}

describe("Loopworks logger", () => {
  it("emits structured JSON with service metadata", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
      },
      sink.destination,
    );

    logger.info(
      {
        route: "test.route",
      },
      "test_event",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 30,
      service: "loopworks",
      route: "test.route",
      msg: "test_event",
    });
    expect(entry.time).toEqual(expect.any(String));
  });

  it("redacts common secret and token fields", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
        base: null,
      },
      sink.destination,
    );

    logger.info(
      {
        accessToken: "vercel-token",
        access_token: "snake-token",
        client_secret: "oauth-secret",
        headers: {
          Authorization: "Bearer github-token",
        },
        private_key: "github-app-private-key",
        nested: {
          refresh_token: "refresh-token",
          token: "nested-token",
        },
      },
      "redaction_test",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      accessToken: "[redacted]",
      access_token: "[redacted]",
      client_secret: "[redacted]",
      headers: {
        Authorization: "[redacted]",
      },
      private_key: "[redacted]",
      nested: {
        refresh_token: "[redacted]",
        token: "[redacted]",
      },
    });
  });

  it("redacts OAuth and webhook-sensitive fields", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
        base: null,
      },
      sink.destination,
    );

    logger.info(
      {
        oauthAccessToken: "oauth-access-token",
        oauthRefreshToken: "oauth-refresh-token",
        webhookSecret: "github-webhook-secret",
        githubWebhookSecret: "github-webhook-secret",
        rawWebhookBody: '{"token":"payload-token"}',
        headers: {
          "x-hub-signature-256": "sha256=signature",
        },
        request: {
          headers: {
            authorization: "Bearer nested-token",
            "x-hub-signature-256": "sha256=nested-signature",
          },
        },
        nested: {
          oauth_access_token: "snake-oauth-token",
          github_webhook_secret: "snake-webhook-secret",
        },
      },
      "sensitive_redaction_test",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      oauthAccessToken: "[redacted]",
      oauthRefreshToken: "[redacted]",
      webhookSecret: "[redacted]",
      githubWebhookSecret: "[redacted]",
      rawWebhookBody: "[redacted]",
      headers: {
        "x-hub-signature-256": "[redacted]",
      },
      request: {
        headers: {
          authorization: "[redacted]",
          "x-hub-signature-256": "[redacted]",
        },
      },
      nested: {
        oauth_access_token: "[redacted]",
        github_webhook_secret: "[redacted]",
      },
    });
  });

  it("attaches the active W3C trace id while preserving structured log fields", () => {
    const sink = createMemoryDestination();
    const logger = createLogger(
      {
        level: "info",
        base: null,
      },
      sink.destination,
    );
    const span = {
      spanContext: () => ({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: TraceFlags.SAMPLED,
      }),
    } as Span;

    context.with(trace.setSpan(context.active(), span), () => {
      logger.info({ route: "test.route" }, "trace_context_test");
    });

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      msg: "trace_context_test",
      route: "test.route",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });
});
