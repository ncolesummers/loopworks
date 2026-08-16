import { context, type Span, TraceFlags, trace } from "@opentelemetry/api";
import { configRegistry } from "@/lib/config/registry";
import {
  createLogger,
  logGithubRepositorySelectionAuthorization,
  loggerRedactionPaths,
} from "@/lib/observability/logger";

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
  it("logs only bounded repository-selection authorization fields", () => {
    const sink = createMemoryDestination();
    const boundedLogger = createLogger({ level: "info", base: null }, sink.destination);

    logGithubRepositorySelectionAuthorization(
      {
        accessToken: "ghu_log_canary",
        authorizationCacheKey: "22808397:124:124001",
        cacheHit: false,
        githubProviderAccountId: "22808397",
        operation: "read",
        outcome: "indeterminate",
        rawError: "provider rejected ghu_log_canary",
      } as never,
      boundedLogger,
    );

    const serialized = sink.writes.join("");
    expect(serialized).not.toContain("ghu_log_canary");
    expect(serialized).not.toContain("22808397");
    expect(serialized).not.toContain("124001");
    expect(JSON.parse(sink.writes[0] ?? "{}")).toMatchObject({
      cacheHit: false,
      msg: "github_repository_selection_authorization",
      operation: "read",
      outcome: "indeterminate",
    });
  });

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

  it("redacts GitHub installation state, authorization codes, and PKCE verifiers", () => {
    const sink = createMemoryDestination();
    const logger = createLogger({ level: "info", base: null }, sink.destination);

    logger.info(
      {
        authorizationCode: "one-time-code",
        codeVerifier: "pkce-verifier",
        githubInstallationState: "opaque-state",
        githubProviderAccountId: "22808397",
        pkceVerifier: "production-pkce-verifier",
        providerAccountId: "22808397",
        rawGithubUserResponse: {
          id: 22_808_397,
          login: "renamed-operator",
          token: "ghu_raw-response-token",
        },
        verifierCookie: "production-cookie-verifier",
        headers: {
          cookie: "loopworks-github-install-pkce=header-verifier",
          Cookie: "loopworks-github-install-pkce=uppercase-header-verifier",
        },
        request: {
          headers: { Cookie: "loopworks-github-install-pkce=request-header-verifier" },
        },
        req: {
          headers: { Cookie: "loopworks-github-install-pkce=req-header-verifier" },
        },
        transport: {
          headers: { Cookie: "loopworks-github-install-pkce=nested-header-verifier" },
        },
        nested: {
          authorization_code: "nested-code",
          code_verifier: "nested-verifier",
          github_installation_state: "nested-state",
          github_provider_account_id: "22808397",
          provider_account_id: "22808397",
          raw_github_user_response: { id: 22_808_397 },
        },
      },
      "github_installation_redaction_test",
    );

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      authorizationCode: "[redacted]",
      codeVerifier: "[redacted]",
      githubInstallationState: "[redacted]",
      githubProviderAccountId: "[redacted]",
      pkceVerifier: "[redacted]",
      providerAccountId: "[redacted]",
      rawGithubUserResponse: "[redacted]",
      verifierCookie: "[redacted]",
      headers: { cookie: "[redacted]", Cookie: "[redacted]" },
      request: { headers: { Cookie: "[redacted]" } },
      req: { headers: { Cookie: "[redacted]" } },
      transport: { headers: { Cookie: "[redacted]" } },
      nested: {
        authorization_code: "[redacted]",
        code_verifier: "[redacted]",
        github_installation_state: "[redacted]",
        github_provider_account_id: "[redacted]",
        provider_account_id: "[redacted]",
        raw_github_user_response: "[redacted]",
      },
    });
  });

  it("redacts provider identity and token material at arbitrary structured-log depth", () => {
    const sink = createMemoryDestination();
    const logger = createLogger({ level: "info", base: null }, sink.destination);

    logger.info(
      {
        outer: {
          inner: {
            githubProviderAccountId: "22808397",
            token: "ghu_deep_token_canary",
          },
        },
      },
      "deep_redaction_test",
    );

    expect(JSON.parse(sink.writes[0] ?? "{}")).toMatchObject({
      outer: {
        inner: {
          githubProviderAccountId: "[redacted]",
          token: "[redacted]",
        },
      },
    });
  });

  it("derives redaction paths for every registry secret", () => {
    const secretNames = configRegistry.filter((entry) => entry.secret).map((entry) => entry.name);
    for (const name of secretNames) {
      expect(loggerRedactionPaths).toContain(name);
      expect(loggerRedactionPaths).toContain(`*.${name}`);
    }

    const sink = createMemoryDestination();
    const logger = createLogger({ level: "info", base: null }, sink.destination);
    const secretValues = Object.fromEntries(secretNames.map((name) => [name, `value-for-${name}`]));

    logger.info({ ...secretValues, nested: secretValues }, "registry_secret_redaction_test");

    const entry = JSON.parse(sink.writes[0] ?? "{}") as Record<string, unknown>;
    for (const name of secretNames) {
      expect(entry[name]).toBe("[redacted]");
      expect((entry.nested as Record<string, unknown>)[name]).toBe("[redacted]");
    }
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
