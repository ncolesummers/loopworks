# ADR 0003: Pino Structured Logging And Metrics Contract

Status: Accepted
Date: 2026-06-20

## Context

Loopworks will operate agentic workflows that make plans, create artifacts, ask for approvals, run deterministic validation, and eventually prepare PRs. These workflows need strong observability from the beginning. Logs must answer what happened, why it happened, which external event caused it, who approved it, and what evidence exists.

The project also needs room for metrics and traces without prematurely selecting every backend.

## Decision

Loopworks will use Pino for structured JSON logging. Logs must include stable service metadata, correlation fields, and redaction for tokens, secrets, auth headers, OAuth fields, and webhook-sensitive data.

Loopworks will define a metrics and trace contract early even while the concrete backend remains open. Runtime logs are not the event store. Durable product state belongs in the control-plane database, and metrics/traces are operational telemetry.

## Consequences

Pino gives fast structured logs with low ceremony. Correlation fields make it possible to connect GitHub delivery ids, run ids, step ids, approval ids, Vercel deployment ids, trace ids, and validation artifacts.

The implementation must be disciplined about what is logged. Agent prompts, raw webhook payloads, tokens, private keys, and OAuth profiles should not be logged without explicit review.

## Validation

1. API and integration boundaries use the shared logger or request-scoped child loggers.
2. Tests cover redaction for common camelCase and snake_case secret fields.
3. Fixture fallbacks log explicit reasons.
4. Docs list required correlation fields for webhooks, Vercel calls, validation, approvals, and agent steps.
5. Future workflow execution propagates run id, step id, delivery id, and trace id.

## Follow-Ups

1. Choose the metrics backend and trace collector.
2. Add counters for run status, validation results, webhook outcomes, deployment health, queue depth, cost, and approval wait time.
3. Define alert thresholds for stuck runs, failed webhooks, approval age, and repeated validation failures.
4. Add log sampling and retention guidance before high-volume workflow execution.
