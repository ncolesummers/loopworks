import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { withActiveTraceId } from "@/lib/observability/trace-context";

const redactedPaths = [
  "accessToken",
  "access_token",
  "authorization",
  "clientSecret",
  "client_secret",
  "headers.authorization",
  "headers.Authorization",
  'headers["x-hub-signature-256"]',
  "request.headers.authorization",
  "request.headers.Authorization",
  'request.headers["x-hub-signature-256"]',
  "req.headers.authorization",
  "req.headers.Authorization",
  'req.headers["x-hub-signature-256"]',
  "*.headers.authorization",
  "*.headers.Authorization",
  '*["headers"]["x-hub-signature-256"]',
  "githubWebhookSecret",
  "github_webhook_secret",
  "idToken",
  "id_token",
  "oauthAccessToken",
  "oauthRefreshToken",
  "oauth_access_token",
  "oauth_refresh_token",
  "password",
  "privateKey",
  "private_key",
  "rawWebhookBody",
  "raw_webhook_body",
  "refreshToken",
  "refresh_token",
  "secret",
  "token",
  "webhookSecret",
  "webhook_secret",
  "*.accessToken",
  "*.access_token",
  "*.authorization",
  "*.clientSecret",
  "*.client_secret",
  "*.githubWebhookSecret",
  "*.github_webhook_secret",
  "*.idToken",
  "*.id_token",
  "*.oauthAccessToken",
  "*.oauthRefreshToken",
  "*.oauth_access_token",
  "*.oauth_refresh_token",
  "*.password",
  "*.privateKey",
  "*.private_key",
  "*.rawWebhookBody",
  "*.raw_webhook_body",
  "*.refreshToken",
  "*.refresh_token",
  "*.secret",
  "*.token",
  "*.webhookSecret",
  "*.webhook_secret",
];

export type LoopworksLogger = Logger;

function defaultBaseBindings() {
  return {
    service: "loopworks",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  };
}

function buildLoggerOptions(options: LoggerOptions): LoggerOptions {
  const { base, mixin, redact, ...rest } = options;

  return {
    level: process.env.LOG_LEVEL ?? "info",
    base: base === null ? null : { ...defaultBaseBindings(), ...(base ?? {}) },
    redact: redact ?? {
      paths: redactedPaths,
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
