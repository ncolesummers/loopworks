# Loopworks

Loopworks turns labeled GitHub issues into durable software-delivery runs. It
coordinates planning, red-test writing, implementation, validation, review, and
draft-PR preparation while GitHub remains the source of truth for intent and
collaboration.

[Case study](https://n-cole-summers.dev/projects/loopworks) ·
[Architecture](docs/architecture.md) ·
[Contributing](CONTRIBUTING.MD)

## Status

Loopworks is pre-1.0 and under active development. The development-loop control
plane is implemented; research-loop execution remains fail-closed until its
specialized agents are declared. Expect interfaces and configuration to change.

## What it does

- Admits work through verified GitHub App webhooks, delivery-id idempotency, and
  durable run leases.
- Persists stages, artifacts, approvals, retries, and operational evidence in
  Postgres instead of treating GitHub comments or logs as an event store.
- Runs deterministic validation before agent review.
- Requires digest-bound human approval before plan execution and guarded GitHub
  writes. The write path produces a draft pull request; it never merges one.
- Emits vendor-neutral telemetry through OpenTelemetry with structured Pino
  logs linked to active trace context.

The application uses Next.js and Bun, Postgres with Drizzle, Auth.js and a
GitHub App, Eve agents, Vitest, Playwright, and Storybook.

## Quick start

Install dependencies and start the portal with explicit non-production fixture
data and local authentication bypass:

```bash
bun install
LOOPWORKS_PORTAL_DATA_MODE=fixtures bun run dev:fixture
```

Open <http://127.0.0.1:3000>. For real GitHub, Postgres, webhook, seed, and
native-test setup, use the [development guide](docs/development.md). The
generated [`.env.example`](.env.example) is the canonical configuration
inventory.

## Validation

Run the repository-owned aggregate gate:

```bash
bun run validate
```

App and runtime changes also require:

```bash
bun run build
```

## Contributing

Loopworks work is issue-backed, test-driven, and reviewable. Read the
[contribution guide](CONTRIBUTING.MD) and the nearest `AGENTS.md` before making
changes.

## Documentation

- Product intent: [requirements](docs/prd.md) and
  [personas and test scenarios](docs/personas-and-test-scenarios.md)
- System contracts: [architecture](docs/architecture.md),
  [loop manifest](docs/loop-manifest.md), and [ADR index](docs/adr/README.md)
- Local operation: [development guide](docs/development.md) and
  [`.env.example`](.env.example)
- Hosted operation: [Vercel and Neon runbook](docs/runbooks/vercel-neon-deployment.md)
- Assurance: [observability](docs/observability.md) and
  [MVP security review](docs/security-review.md)

## License

[MIT](LICENSE)
