# ADR 0007: Explicit Seed Data And Fixture Policy

Status: Accepted
Date: 2026-06-20

## Context

Loopworks needs local and development stand-ins for GitHub OAuth, GitHub webhooks, Vercel deployments, repo catalogs, loop runs, artifacts, and approval gates. These fixtures make the app inspectable early and support Playwright, Storybook, and demos. The risk is that fixture behavior can silently mask missing production integration.

## Decision

Loopworks will use explicit seed data and fixtures for local development, tests, Storybook, and demos. Fixture mode must be obvious in code, API responses, logs, and docs.

Production code must not silently fall back to fake data when required credentials or durable stores are missing. Production paths should fail closed with an actionable error or degraded-state response.

## Consequences

This keeps the MVP usable before every external integration is fully wired. It also creates a responsibility to maintain fixture quality so local examples exercise real states: empty, loading, healthy, disabled, blocked, failed, pending approval, approved, rejected, preview, production, and disconnected.

Seed data must never contain real tokens, private keys, customer data, or secret-looking placeholder values.

## Validation

1. Fixture routes and scripts are named explicitly, such as `dev:fixture`.
2. API responses include a fixture or fallback reason when returning stand-in data.
3. Logs include fallback reasons without logging secrets or raw payloads.
4. Playwright and Storybook exercise fixture data intentionally.
5. Production environments reject unsafe local auth bypasses and unsupported in-memory stores.

## Follow-Ups

1. Add a seeded demo dataset for repos, loops, runs, approvals, artifacts, and Vercel deployments.
2. Add reset and reseed commands after the database bootstrap exists.
3. Add tests that fixture fallback cannot run in production.
4. Document how to create new fixture states for Storybook and Playwright.
