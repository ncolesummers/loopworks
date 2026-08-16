import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { configRegistry, readStringConfig } from "@/lib/config/registry";
import { withActiveTraceId } from "@/lib/observability/trace-context";

const genericRedactionPaths = [
  "accessToken",
  "access_token",
  "authorization",
  "authorizationCode",
  "authorization_code",
  "clientSecret",
  "client_secret",
  "codeVerifier",
  "code_verifier",
  "Cookie",
  "cookie",
  "headers.authorization",
  "headers.Authorization",
  "headers.Cookie",
  "headers.cookie",
  'headers["x-hub-signature-256"]',
  "request.headers.authorization",
  "request.headers.Authorization",
  "request.headers.Cookie",
  "request.headers.cookie",
  'request.headers["x-hub-signature-256"]',
  "req.headers.authorization",
  "req.headers.Authorization",
  "req.headers.Cookie",
  "req.headers.cookie",
  'req.headers["x-hub-signature-256"]',
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.headers.Cookie",
  "*.headers.cookie",
  '*["headers"]["x-hub-signature-256"]',
  "githubWebhookSecret",
  "github_webhook_secret",
  "githubInstallationState",
  "github_installation_state",
  "githubProviderAccountId",
  "github_provider_account_id",
  "idToken",
  "id_token",
  "oauthAccessToken",
  "oauthRefreshToken",
  "oauth_access_token",
  "oauth_refresh_token",
  "pkceVerifier",
  "password",
  "privateKey",
  "private_key",
  "rawWebhookBody",
  "raw_webhook_body",
  "rawGithubUserResponse",
  "raw_github_user_response",
  "refreshToken",
  "refresh_token",
  "providerAccountId",
  "provider_account_id",
  "secret",
  "token",
  "verifierCookie",
  "webhookSecret",
  "webhook_secret",
  "*.accessToken",
  "*.access_token",
  "*.authorization",
  "*.authorizationCode",
  "*.authorization_code",
  "*.clientSecret",
  "*.client_secret",
  "*.codeVerifier",
  "*.code_verifier",
  "*.Cookie",
  "*.cookie",
  "*.githubWebhookSecret",
  "*.github_webhook_secret",
  "*.githubInstallationState",
  "*.github_installation_state",
  "*.githubProviderAccountId",
  "*.github_provider_account_id",
  "*.idToken",
  "*.id_token",
  "*.oauthAccessToken",
  "*.oauthRefreshToken",
  "*.oauth_access_token",
  "*.oauth_refresh_token",
  "*.pkceVerifier",
  "*.password",
  "*.privateKey",
  "*.private_key",
  "*.rawWebhookBody",
  "*.raw_webhook_body",
  "*.rawGithubUserResponse",
  "*.raw_github_user_response",
  "*.refreshToken",
  "*.refresh_token",
  "*.providerAccountId",
  "*.provider_account_id",
  "*.secret",
  "*.token",
  "*.verifierCookie",
  "*.webhookSecret",
  "*.webhook_secret",
];

const registrySecretRedactionPaths = configRegistry
  .filter((definition) => definition.secret)
  .flatMap((definition) => [definition.name, `*.${definition.name}`]);

export const loggerRedactionPaths = [
  ...new Set([...genericRedactionPaths, ...registrySecretRedactionPaths]),
];

const recursivelyRedactedKeys = new Set([
  ...genericRedactionPaths.filter(
    (path) => !path.includes(".") && !path.includes("[") && !path.includes("*"),
  ),
  ...configRegistry.filter((definition) => definition.secret).map((definition) => definition.name),
  "x-hub-signature-256",
]);

function redactNestedLogValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap(),
): unknown {
  if (typeof value !== "object" || value === null) return value;

  const existing = seen.get(value);
  if (existing) return existing;

  if (Array.isArray(value)) {
    const redacted: unknown[] = [];
    seen.set(value, redacted);
    for (const item of value) redacted.push(redactNestedLogValue(item, seen));
    return redacted;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const redacted: Record<string, unknown> = {};
  seen.set(value, redacted);
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = recursivelyRedactedKeys.has(key)
      ? "[redacted]"
      : redactNestedLogValue(nestedValue, seen);
  }
  return redacted;
}

export type LoopworksLogger = Logger;

export type RepositorySelectionAuthorizationObservation = {
  cacheHit: boolean;
  operation: "apply" | "read";
  outcome: "access-denied" | "authorized" | "indeterminate";
};

function defaultBaseBindings() {
  return {
    service: "loopworks",
    environment: readStringConfig("VERCEL_ENV") ?? readStringConfig("NODE_ENV") ?? "development",
    deploymentId: readStringConfig("VERCEL_DEPLOYMENT_ID"),
  };
}

function buildLoggerOptions(options: LoggerOptions): LoggerOptions {
  const { base, formatters, mixin, redact, ...rest } = options;

  return {
    level: readStringConfig("LOG_LEVEL") ?? "info",
    base: base === null ? null : { ...defaultBaseBindings(), ...(base ?? {}) },
    formatters: {
      ...formatters,
      bindings(bindings) {
        const formatted = formatters?.bindings?.(bindings) ?? bindings;
        return redactNestedLogValue(formatted) as Record<string, unknown>;
      },
      log(object) {
        const formatted = formatters?.log?.(object) ?? object;
        return redactNestedLogValue(formatted) as Record<string, unknown>;
      },
    },
    redact: redact ?? {
      paths: loggerRedactionPaths,
      censor: "[redacted]",
    },
    mixin(mergeObject, level, logger) {
      return withActiveTraceId(
        (mixin?.(mergeObject, level, logger) ?? {}) as Record<string, unknown>,
      );
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...rest,
  };
}

export function createLogger(
  options: LoggerOptions = {},
  destination?: DestinationStream,
): LoopworksLogger {
  const loggerOptions = buildLoggerOptions(options);
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

export const logger = createLogger();

export function createRequestLogger(
  bindings: Record<string, string | number | boolean | null | undefined>,
): LoopworksLogger {
  return logger.child(bindings);
}

export function logGithubRepositorySelectionAuthorization(
  observation: RepositorySelectionAuthorizationObservation,
  target: LoopworksLogger = logger,
): void {
  try {
    target.info(
      {
        cacheHit: observation.cacheHit,
        operation: observation.operation,
        outcome: observation.outcome,
      },
      "github_repository_selection_authorization",
    );
  } catch {
    // Authorization must not depend on telemetry sink health.
  }
}
