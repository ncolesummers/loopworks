# ADR 0012: Telemetry Backend And Metric Contract

Status: Proposed
Date: 2026-07-03

Driving issue: [#21](https://github.com/ncolesummers/loopworks/issues/21)

## Context

ADR 0003 established Pino structured logging and deferred the metrics backend and trace collector decision. That deferral is now the blocker: the development-loop agents (#47, #48) are about to be built, and agents implemented before a telemetry contract exists would hand-roll instrumentation that needs retrofitting. Today the codebase has no OpenTelemetry dependency, one ad hoc metric name (`development_loop_run_created` written to the `observability_events` table), and `trace_id` columns in the control-plane schema that nothing populates.

Two decisions are needed: which backend receives telemetry, and what the metric, span, and correlation vocabulary is. The vocabulary is the durable part; the backend must be swappable behind it.

Four backends were evaluated against a fixed rubric; the table summarizes the deciding dimensions (OTLP ingest, free tier and retention, Vercel fit, alerting, LLM observability, lock-in), and the full rubric with per-backend fact sheets and sources is recorded on issue #21. Azure Monitor was included because the maintainer holds a Visual Studio subscription with monthly Azure credits.

| | Axiom | Grafana Cloud | Honeycomb | Azure Monitor / App Insights |
| --- | --- | --- | --- | --- |
| OTLP ingest (traces/metrics/logs) | All three, OTLP/HTTP protobuf only; metrics need a dedicated dataset | All three via one OTLP gateway endpoint | All three, gRPC and HTTP | No plain OTLP endpoint from non-Azure hosts; requires self-run OTel Collector with Entra auth |
| Free tier | 500 GB/mo ingest, 30-day retention | Host-hour capped; 14-day metric retention (logs/traces ~30, docs conflict) | 20M events/mo, unlimited seats; retention unpublished | 5 GB/mo Log Analytics grant, then $2.76/GB; 90-day retention |
| Vercel fit | Marketplace integration; `@vercel/otel` pairing undocumented (verify at implementation) | Documented `@vercel/otel` + Next.js guide | Documented Next.js guide; works with `@vercel/otel` | Poor: collector must be hosted somewhere; Entra auth, no connection-string OTLP |
| Alerting | Monitors → email/Slack/PagerDuty/webhook | Full Grafana Alerting on free tier | Triggers + SLO burn alerts on free tier | Metric + KQL alerts; cost scales with cardinality |
| LLM usage/cost | Native (ModelDB span enrichment, GenAI dashboard) | Native GenAI observability incl. Vercel AI SDK integration | Native GenAI semconv + agent observability | Native via Foundry integration |
| Lock-in | OTel-native; exporter swap to exit | OTel-native; exporter swap to exit | OTel-native; exporter swap to exit | Moderate (distro or self-run collector) |
| Notable constraint | Log drains need Vercel Pro (avoidable via direct OTLP/pino transport) | 2026 pricing bills per host-hour — poor fit for serverless | Metrics dashboards are secondary to its trace-centric model | VS subscriber credits are contractually dev/test-only; production telemetry on credits risks suspension; hard stop when credits exhaust |

Research fact sheets with sources are recorded on issue #21.

## Decision

1. Instrument with OpenTelemetry APIs only, wired through `@vercel/otel` with standard OTLP/HTTP exporters configured by environment variables. No backend-specific SDK may appear outside `src/lib/observability/`.
2. Adopt **Axiom** as the first metrics backend and trace collector. Rationale: Vercel Marketplace-native provisioning matches the ADR 0002 Vercel-first direction; the 500 GB/month free tier with 30-day retention comfortably covers a solo-operator control plane across dev and prod; one product surface and one query language (APL) suit a single maintainer; native LLM cost/token enrichment directly serves the `model usage` and `cost` metrics required by #21. Grafana Cloud is the designated runner-up if Axiom fails validation — its host-hour pricing and three query languages made it second, not its capability.
3. Azure Monitor is rejected as the telemetry backend. Visual Studio subscriber credits cannot fund production workloads under their dev/test terms, credits hard-stop mid-month when exhausted, and OTLP ingest from Vercel requires hosting an OpenTelemetry Collector with Entra auth — standing infrastructure that defeats the credits' value. The credits remain available for unrelated dev/test experimentation.
4. Adopt the metric contract below. Meter names are dotted, `loopworks.`-prefixed, with low-cardinality attributes. These names are the stable interface that loop stages, agents, and integrations instrument against, regardless of backend.

### Metric contract

| Metric | Instrument | Unit | Required attributes |
| --- | --- | --- | --- |
| `loopworks.run.started` | counter | `{run}` | `loop.key`, `repository`, `trigger.label` |
| `loopworks.run.completed` | counter | `{run}` | `loop.key`, `repository`, `status` (`succeeded`, `failed`, `cancelled`) |
| `loopworks.run.duration` | histogram | `s` | `loop.key`, `status` |
| `loopworks.step.duration` | histogram | `s` | `loop.key`, `stage`, `status` |
| `loopworks.step.retries` | counter | `{retry}` | `loop.key`, `stage`, `reason` |
| `loopworks.validation.outcome` | counter | `{check}` | `gate`, `command`, `status` (`pass`, `fail`) |
| `loopworks.validation.duration` | histogram | `s` | `gate`, `command` |
| `loopworks.webhook.outcome` | counter | `{delivery}` | `event`, `action`, `outcome` (`accepted`, `rejected`, `duplicate`, `invalid_signature`, `error`) |
| `loopworks.deployment.observed` | counter | `{deployment}` | `environment`, `status` |
| `loopworks.approval.wait_time` | histogram | `s` | `gate`, `decision` (`approved`, `rejected`, `expired`, `bypassed`) |
| `loopworks.approval.pending` | observable gauge | `{approval}` | `gate` |
| `loopworks.queue.depth` | observable gauge | `{run}` | `loop.key` |
| `loopworks.lock.contention` | counter | `{conflict}` | `scope` |
| `loopworks.model.requests` | counter | `{request}` | `model`, `provider`, `agent`, `outcome` |
| `loopworks.model.tokens` | counter | `{token}` | `model`, `provider`, `agent`, `direction` (`input`, `output`) |
| `loopworks.model.cost` | counter | `USD` | `model`, `provider`, `agent` |

Run cancellations are counted as `loopworks.run.completed` with `status="cancelled"`, not a separate metric. Agent spans additionally carry OpenTelemetry GenAI semantic-convention attributes (`gen_ai.*`) so backend-native LLM dashboards work without custom mapping.

### Relationship to `observability_events`

The `observability_events.metric_name` column keeps its snake_case event vocabulary (for example `development_loop_run_created` and `research_loop_run_created`): those rows are durable control-plane records for audit and replay, per the "logs are not the event store" rule. OTel meters are operational telemetry. Where both exist, one instrumentation helper emits both from a single call site. Development creation maps to `loopworks.run.started{loop.key="development-loop", trigger.label="agent-ready"}` and research creation maps to `loopworks.run.started{loop.key="research-loop", trigger.label="spike"}`. Neither vocabulary may be written ad hoc outside `src/lib/observability/` helpers.

### Correlation alignment

| Log field (Pino) | Control-plane column | OTel attribute |
| --- | --- | --- |
| `runId` | `loop_runs.id` | `loopworks.run.id` |
| `stepId` | `run_steps.id` | `loopworks.step.id` |
| `deliveryId` | `webhook_deliveries.delivery_id`, `observability_events.correlation_id` | `loopworks.github.delivery_id` |
| `approvalId` | `approvals.id` | `loopworks.approval.id` |
| `deploymentId` | Vercel deployment records | `loopworks.vercel.deployment_id` |
| `repository` | `repositories` | `loopworks.repository` |
| `traceId` | `loop_runs.trace_id`, `run_steps.trace_id`, `observability_events.trace_id` | W3C trace id from active span context |

The active W3C trace id is persisted into the `trace_id` columns at development- and research-run creation, their steps, and their durable creation events, closing the loop between spans, logs, and durable records. Artifacts carry no `trace_id` of their own: `artifacts.run_id` and `artifacts.step_id` correlate them transitively through the owning run and step.

### Rollout

1. Local development: the OTel SDK is always registered; exporters default to no-op/console. Shipping to Axiom is opt-in via the standard `OTEL_EXPORTER_OTLP_*` variables, with `environment` as a resource attribute separating dev from prod data.
2. Preview and production: provision Axiom through the Vercel Marketplace integration; datasets split per Axiom's requirement (one events dataset for traces/logs, one metrics dataset).
3. Retention: the 30-day free-tier window is sufficient because durable state lives in the control-plane database; paid retention is a later decision only if operational investigation demands it.
4. Pino logs continue to stdout for Vercel log capture; shipping them to Axiom (OTLP logs or pino transport, without requiring Vercel Pro log drains) is a follow-up decision.

## Consequences

Loop stages and agents get a stable instrumentation vocabulary before any of them are built, which was the blocking risk. The backend stays swappable: leaving Axiom means changing exporter env vars, not call sites. Costs stay at zero until volume grows well beyond a solo control plane.

Constraints accepted: OTLP over HTTP/protobuf only (no gRPC — irrelevant on serverless), separate Axiom datasets for metrics versus events, and one unverified integration detail (`@vercel/otel` with Axiom endpoints) that must be validated in preview before this ADR moves to Accepted.

## Validation

1. A preview deployment exports traces, metrics, and logs to Axiom via `@vercel/otel` with only env-var configuration.
2. Instrumentation helpers in `src/lib/observability/` are the only call sites that name meters or `observability_events` metric names; review enforces this.
3. `trace_id` columns are populated on run and step creation and match the trace visible in Axiom.
4. Metric names emitted in code match this contract exactly; a unit test asserts the exported name set.
5. Redaction tests still pass; no telemetry attribute carries tokens, secrets, or raw payloads.

## Follow-Ups

1. Wire `@vercel/otel`, OTLP exporters, resource attributes, and meter/span helpers in `src/lib/observability/` (implementation issue after acceptance).
2. Instrument webhook intake, loop stages, validation gates, approvals, and locks with the metric contract.
3. Decide and wire the Pino-to-Axiom log path.
4. Build the initial Axiom dashboards (run health, approval latency, model cost) and the alert monitors from ADR 0003 follow-up 3 (stuck runs, failed webhooks, approval age, repeated validation failures).
5. Verify the `@vercel/otel` + Axiom pairing in a preview deployment; if it fails, execute the Grafana Cloud fallback without contract changes.
6. Resolve PRD open question 6 by linking it here.
