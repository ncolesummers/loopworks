# MVP Security Review

## Purpose

This review is the final MVP gate. It checks that the portal is safe enough to operate with real repositories, real GitHub accounts, and live deployment metadata.

## Scope

1. Authentication and session handling.
2. GitHub token handling and least privilege.
3. Vercel data access and display.
4. Database access and tenant isolation.
5. Server-side authorization checks.
6. Logging, auditability, and error handling.
7. Agent actions that can affect external systems.
8. Structured logging redaction and correlation safety.

## Review Questions

1. Can a user see only repositories and data they are allowed to access?
2. Are tokens stored, refreshed, and scoped safely?
3. Are write actions behind explicit authorization and review gates?
4. Are secrets excluded from logs, previews, and UI output?
5. Can the system explain how a high-risk action was triggered?
6. Is there a clear rollback or containment path for bad automation?
7. Do Pino logs preserve useful correlation ids without leaking tokens, payload bodies, OAuth data, or private keys?

## Auth And Session Notes

1. Real portal sessions use Auth.js GitHub SSO with database-backed Drizzle
   sessions.
2. The GitHub `login` is persisted as `users.github_login` and is the operator
   identity used for approval and future run attribution.
3. Username and organization allowlists fail closed when
   `LOOPWORKS_AUTH_BYPASS` is not active.
4. Active organization-allowlist sessions revalidate membership through the
   persisted GitHub OAuth token and fail closed when token or org evidence is
   unavailable.
5. `LOOPWORKS_AUTH_BYPASS` is a local fixture path only and must remain disabled
   in production.
6. OAuth access tokens may exist in the Auth.js accounts table; logs and UI must
   never expose tokens, raw OAuth profiles, or authorization headers.

## Required Checks

1. Session validation and CSRF protections.
2. Repo access verification on every sensitive request.
3. Secret redaction in logs and surfaced summaries.
4. Safe defaults for any external write operation.
5. Auditable records for approvals and automation actions.
6. Basic rate limiting or abuse controls where applicable.
7. Structured log samples for webhook rejection, duplicate delivery, approval rejection, and Vercel API fallback.
8. Username/org allowlist coverage for allowed and denied GitHub identities.

## Exit Criteria

1. No open high-severity findings.
2. Token and session handling are documented.
3. External write paths are explicitly gated.
4. Audit records exist for key agent and operator actions.
5. The MVP can be used without exposing secrets or cross-tenant data.
