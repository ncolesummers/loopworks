# App Guide

## Scope

This guide applies to Next.js app code, API routes, Auth.js boundaries, Drizzle
state, GitHub/Vercel integrations, approvals, and shared app contracts under
`src/`.

## Rules

1. Follow existing Next.js App Router, TypeScript, ShadCN/UI, Tailwind, Drizzle,
   Auth.js, Pino, Vitest, and Playwright patterns.
2. Prefer typed contracts and schemas over ad hoc object shapes.
3. Protect app and internal API routes by default; local auth bypass stays
   non-production only.
4. Verify GitHub webhook signatures before processing payloads.
5. Persist durable workflow state in Drizzle tables, not logs or GitHub
   comments.
6. Gate external writes on explicit approvals and audit attribution.
7. Use OTel for telemetry and redact secrets, auth material, raw webhook bodies,
   OAuth tokens, and unreviewed prompts.
8. Make fixture fallbacks explicit in API responses and structured logs.
9. Keep durable auth policy logic in `src/lib/auth/`; reserve `src/auth.ts` for
   Auth.js provider, adapter, callback, and session orchestration.
10. Cache authorization results only for successful decisions unless tests prove
    denied or missing-evidence states still fail closed.

## Tests

Cover auth, GitHub/Vercel integration, webhooks, approvals, manifests, and
observability boundaries.
