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
  "refreshToken",
  "refresh_token",
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
  "*.refreshToken",
  "*.refresh_token",
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

export type LoopworksLogger = Logger;

function defaultBaseBindings() {
  return {
    service: "loopworks",
    environment: readStringConfig("VERCEL_ENV") ?? readStringConfig("NODE_ENV") ?? "development",
    deploymentId: readStringConfig("VERCEL_DEPLOYMENT_ID"),
  };
}

function buildLoggerOptions(options: LoggerOptions): LoggerOptions {
  const { base, mixin, redact, ...rest } = options;

  return {
    level: readStringConfig("LOG_LEVEL") ?? "info",
    base: base === null ? null : { ...defaultBaseBindings(), ...(base ?? {}) },
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
