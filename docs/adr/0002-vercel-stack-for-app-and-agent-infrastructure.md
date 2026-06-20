# ADR 0002: Vercel Stack For App And Agent Infrastructure

Status: Accepted
Date: 2026-06-20

## Context

Loopworks must make it easy to check the built application while managing agentic development loops. The portal needs first-class visibility into production and preview deployments, branch and commit metadata, deployment health, and links back to the running app. The target stack also includes Vercel Workflows, Vercel Sandbox, Vercel Connect, and Vercel AI Gateway as likely infrastructure for long-running agent workflows and controlled execution.

## Decision

Loopworks will use Vercel as the primary application and agent infrastructure direction:

1. Host the Next.js portal on Vercel.
2. Use Vercel deployment APIs for production and preview visibility.
3. Link catalog repositories to Vercel projects.
4. Keep MVP scope focused on deployments, previews, event/log summaries, and links back to Vercel.
5. Treat Vercel Workflows, Sandbox, Connect, and AI Gateway as the expansion path for durable workflow execution, sandboxed agent work, source-system access, and model routing.

## Consequences

This makes built app visibility a core portal capability rather than a separate operational dashboard. It also creates a clear integration boundary: Vercel owns project and deployment truth, while Loopworks owns derived catalog projections, run linkage, and workflow state.

The MVP should not attempt broad Vercel administration. Environment variable mutation, rollback automation, project creation, and deployment policy administration are later decisions.

## Validation

1. Catalog repos can link to Vercel project identifiers.
2. Deployment views show production and preview status, URLs, branches, commits, age, and Vercel links.
3. API responses and logs identify fixture fallback reasons when Vercel credentials are not configured.
4. Vercel integration tests cover deployment mapping and status normalization.

## Follow-Ups

1. Decide the minimum Vercel token scope and document it in the security review.
2. Choose the initial depth for deployment event and log summaries.
3. Decide when Vercel Workflows becomes the durable workflow executor instead of a local skeleton.
4. Add rate-limit and outage behavior for Vercel API calls.
