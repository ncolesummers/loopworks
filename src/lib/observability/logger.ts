import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const redactedPaths = [
  "accessToken",
  "access_token",
  "authorization",
  "clientSecret",
  "client_secret",
  "headers.authorization",
  "headers.Authorization",
  "idToken",
  "id_token",
  "password",
  "privateKey",
  "private_key",
  "refreshToken",
  "refresh_token",
  "secret",
  "token",
  "*.accessToken",
  "*.access_token",
  "*.authorization",
  "*.clientSecret",
  "*.client_secret",
  "*.idToken",
  "*.id_token",
  "*.password",
  "*.privateKey",
  "*.private_key",
  "*.refreshToken",
  "*.refresh_token",
  "*.secret",
  "*.token",
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
  const { base, redact, ...rest } = options;

  return {
    level: process.env.LOG_LEVEL ?? "info",
    base: base === null ? null : { ...defaultBaseBindings(), ...(base ?? {}) },
    redact: redact ?? {
      paths: redactedPaths,
      censor: "[redacted]",
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
