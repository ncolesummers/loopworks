# Observability

## Position

Observability is a core product requirement for Loopworks, not an operational afterthought. The platform is meant to run agentic workflows that mutate planning state, create artifacts, request approvals, and eventually prepare PRs. Every important action needs enough structured evidence for maintainers to answer what happened, why it happened, who or what caused it, and what should happen next.

## Current Foundation

Loopworks uses Pino for structured JSON logging and `@vercel/otel` for the
OpenTelemetry foundation. These decisions are captured in
`adr/0003-pino-structured-logging-and-metrics-contract.md` and
`adr/0012-telemetry-backend-and-metric-contract.md`. The shared logger lives in
`src/lib/observability/logger.ts` and provides:

1. Stable service metadata: service name, environment, and deployment id.
2. ISO timestamps for logs.
3. `LOG_LEVEL` control.
4. Default redaction for common token, secret, password, authorization, and access-token fields.
5. Request-scoped child loggers for API boundaries.
6. Active W3C `traceId` attachment when an OTel span is available.

The Next.js runtime registers OTel from `src/instrumentation.ts` for the Node.js
runtime only. Resource attributes include stable service, environment,
deployment, Vercel, runtime, and Git revision fields so traces and metrics can
be queried consistently across local, preview, and production environments.

## Logging Rules

1. Use structured fields instead of string interpolation for identifiers, state, status, and counts.
2. Log at integration boundaries: GitHub webhooks, Vercel API calls, approval transitions, manifest reads, validation execution, and agent run steps.
3. Include correlation identifiers where available: GitHub delivery id, repository full name, issue number, run id, loop key, approval id, Vercel project id, deployment id, PR number, and trace id.
4. Never log raw tokens, webhook payload bodies, private keys, authorization headers, OAuth profiles, or full unreviewed agent prompts.
5. Log deterministic validation outcomes as structured summaries and store raw artifacts separately.
6. Prefer explicit fallback reasons over silent fallback behavior.

## MVP Events

The MVP should emit structured logs for:

1. GitHub webhook received, rejected, duplicated, processed, and trigger decision.
2. Vercel deployment fetch success, API failure, exception, and fixture fallback reason.
3. Approval transition applied or rejected.
4. Loop manifest read and later manifest validation failures.
5. Development-loop run creation, stage transition, retry, cancellation, validation result, approval wait, and completion.
6. Planning-agent invocation, tool call summary, artifact creation, and policy block.

Development-loop skeleton creation also writes durable `observability_events`
rows so logs are not the only audit surface:

1. `development_loop_run_created`: includes repository, issue, loop key, run id,
   stage count, artifact count, and GitHub delivery correlation where available.
2. `development_loop_noop`: records skipped development-loop triggers such as
   `loop_disabled` without creating a run.

Approval transitions also persist durable audit rows in
`approval_transition_events`. The API logs `approval_transition_applied`,
`approval_transition_rejected`, `approval_transition_not_found`, and
`approval_transition_stale_state` with approval id, run id where available,
actor id, auth mode, current status, next status, and action. Durable audit
metadata also records auth mode so local fixture actors are distinguishable from
GitHub-authenticated actors. A bypass is recorded as the `bypass` action moving
`requested` to `bypassed`; it must not be represented as a missing approval or
log-only override.

## Control Plane Metrics

The internal control plane should eventually expose:

1. Run counts by status, loop, repo, and stage.
2. Step duration and retry counts.
3. Validation pass/fail/skip counts.
4. Approval wait time and rejection rates.
5. GitHub webhook duplicate/reject/process counts.
6. Vercel deployment readiness and failure counts.
7. Agent cost, token, model, and tool usage metrics.
8. Queue depth, concurrency, lock contention, and cancellation counts.

ADR 0012 defines the concrete metric-name contract. The exported metric names
live in `src/lib/observability/metrics.ts`; code should import helpers from that
module instead of naming OTel meters ad hoc. The first wired metric maps the
durable `development_loop_run_created` control-plane event to
`loopworks.run.started` with `loop.key`, `repository`, and `trigger.label`
attributes.

## Tracing Direction

The MVP logger is compatible with trace context. Development-loop run creation
persists the active W3C trace id into `loop_runs.trace_id`,
`run_steps.trace_id`, and `observability_events.trace_id`, allowing Axiom traces,
stdout logs, and durable run records to be correlated.

## Axiom Preview Configuration

Local development is safe by default: leave OTLP exporter variables blank unless
you intentionally want to ship telemetry. Preview and production should use
standard OpenTelemetry environment variables rather than backend-specific SDKs.

For Axiom:

1. Use `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`.
2. Point `OTEL_EXPORTER_OTLP_ENDPOINT` at the Axiom OTLP base domain so
   per-signal paths resolve to `/v1/traces` and `/v1/metrics`.
3. Set `OTEL_EXPORTER_OTLP_TRACES_HEADERS` with the bearer token and the Events
   dataset header for traces.
4. Set `OTEL_EXPORTER_OTLP_METRICS_HEADERS` with the same bearer token and the
   dedicated Metrics dataset header.
5. Keep Pino stdout logging enabled for Vercel runtime logs. Full Pino-to-Axiom
   log shipping, including any `OTEL_EXPORTER_OTLP_LOGS_HEADERS` configuration,
   is tracked separately by issue #65.

## Grafana Cloud Fallback

If the Axiom preview validation fails without requiring metric-contract changes,
use Grafana Cloud as the fallback backend:

1. Create or select a Grafana Cloud stack and open its OpenTelemetry connection
   tile.
2. Generate the OTLP endpoint and token.
3. Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
   `OTEL_EXPORTER_OTLP_ENDPOINT`, and `OTEL_EXPORTER_OTLP_HEADERS` from the
   Grafana connection instructions.
4. Redeploy the same preview and repeat the signed webhook fixture validation:
   trace present, `loopworks.run.started` metric present, stdout log has the
   same `traceId`, and persisted run/step `trace_id` values match when preview
   database access is available.

## Review Checklist

Before closing workflow or integration issues, check:

1. Does the code emit structured logs for success, rejection, fallback, and unexpected failure paths?
2. Are logs correlated to GitHub/Vercel/run identifiers?
3. Are secrets redacted and absent from raw log fields?
4. Is there a durable artifact or database record when a log alone is not enough?
5. Do tests cover redaction or fallback logging for sensitive integration code?
