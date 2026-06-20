# Observability Guide

## Scope

This guide applies to logging, metrics, tracing, redaction, and correlation code
under `src/lib/observability/`.

## Rules

1. Use the shared Pino logger in `src/lib/observability/logger.ts`.
2. Use OTel APIs/SDKs for logs, metrics, and traces.
3. Attach structured logs to active trace context where available.
4. Include correlation fields where available: route, GitHub delivery id, repo,
   issue, loop, run, step, approval, Vercel project, deployment, trace id.
5. Add custom meters for meaningful performance, throughput, and error rates.
6. Preserve trace context across service and integration boundaries.
7. Follow the app-wide redaction policy in `src/AGENTS.md`.
8. Logs are not the event store.

## Tests

Cover redaction, correlation fields, fallback logging, and trace-context
attachment.
