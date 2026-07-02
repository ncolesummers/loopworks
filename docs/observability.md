# Observability

## Position

Observability is a core product requirement for Loopworks, not an operational afterthought. The platform is meant to run agentic workflows that mutate planning state, create artifacts, request approvals, and eventually prepare PRs. Every important action needs enough structured evidence for maintainers to answer what happened, why it happened, who or what caused it, and what should happen next.

## Current Foundation

Loopworks uses Pino for structured JSON logging. This decision is captured in `adr/0003-pino-structured-logging-and-metrics-contract.md`. The shared logger lives in `src/lib/observability/logger.ts` and provides:

1. Stable service metadata: service name, environment, and deployment id.
2. ISO timestamps for logs.
3. `LOG_LEVEL` control.
4. Default redaction for common token, secret, password, authorization, and access-token fields.
5. Request-scoped child loggers for API boundaries.

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

The concrete metrics backend and trace collector are still open decisions. Until those are selected, implementation should still use stable metric names and correlation identifiers so the later backend choice does not force a semantic rewrite.

## Tracing Direction

The MVP logger should be compatible with future trace context. When workflow execution moves into Vercel Workflows, Sandbox, or other distributed execution, run id, step id, GitHub delivery id, and trace id should be propagated through logs, artifacts, and status records.

## Review Checklist

Before closing workflow or integration issues, check:

1. Does the code emit structured logs for success, rejection, fallback, and unexpected failure paths?
2. Are logs correlated to GitHub/Vercel/run identifiers?
3. Are secrets redacted and absent from raw log fields?
4. Is there a durable artifact or database record when a log alone is not enough?
5. Do tests cover redaction or fallback logging for sensitive integration code?
