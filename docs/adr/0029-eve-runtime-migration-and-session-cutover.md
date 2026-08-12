# ADR 0029: Eve Runtime Migration And Session Cutover

Status: Proposed
Date: 2026-08-11
Issue: [#181](https://github.com/ncolesummers/loopworks/issues/181)

## Context

Loopworks entered this work on `eve@0.22.5`. Eve is still a preview framework,
and its supported release moved through several minor lines while issue #181
waited. Treating the version named when the issue was drafted as authoritative
would preserve stale APIs and peer requirements.

The npm registry's `latest` tag resolved to `eve@0.33.2` when implementation
began on 2026-08-11. That release requires Node.js 24 or newer and a non-optional
`ai@^7.0.58` peer. Loopworks already uses Node.js 24, OpenTelemetry API 1.x, and
Just Bash 3.x, so the compatible exact runtime pair is `eve@0.33.2` and
`ai@7.0.58`. Exact pins keep a fast-moving preview runtime from changing without
a reviewed lockfile update.

The session protocol also changed between the old and selected lines. Eve
0.31.0 removed continuation-token client routing in favor of fixed,
ID-addressed session handles. The 0.31.1 compatibility change explicitly
preserves deployment upgrades only for sessions persisted by 0.30.3–0.30.8.
That bridge does not include Loopworks' 0.22.5 sessions.

The issue also asks that the user-level Vercel plugin not be downgraded. The
active cache and the marketplace-pinned Vercel plugin both resolve to 0.45.1,
so this migration makes no user-level plugin change. The Codex session plugin
observed during implementation is a separately managed OpenAI plugin at 0.21.4;
it is not the user-level Claude Code plugin named by the issue and is not
modified by this repository change.

Eve 0.33 also changes overlapping channel messages to cancellation-backed
`turnPolicy: "steer"` by default. A replacement is durably buffered before the
active turn is cancelled, but partial output and completed side effects are not
rolled back. Loopworks does not currently author a channel or call the Eve
client from application source, so no live message path silently changes in
this migration.

## Decision

1. Pin `eve@0.33.2` and its required AI SDK peer `ai@7.0.58` exactly in
   `package.json` and `bun.lock`, and declare Eve's `engines.node` floor as
   Node.js `>=24` in the application manifest.
2. Keep authored agents on Eve's documented filesystem contracts and verify
   discovery, tools, sandboxes, instrumentation, and evals against the bundled
   0.33.2 documentation and CLI.
3. Use fixed `sessionId` handles for new Eve client or channel work. Ordinary
   messages use positional `send(message, options)`; human-input responses use
   `respond(inputResponses, options)`.
4. A session persisted by 0.22.5 must be replaced after cutover. Before
   promotion, stop admitting old work and drain in-flight sessions on the old
   deployment. Record and cancel anything that cannot drain, deploy the new
   runtime, and start a new session rather than attempting an unsupported
   cross-version resume.
5. Do not update or downgrade the user-level Vercel plugin while its active and
   marketplace versions are both 0.45.1.
6. For future authored Loopworks channels and durable stage messages, select
   `turnPolicy: "queue"` unless cancellation-backed replacement is an explicit,
   tested product behavior. Use `turnPolicy: "steer"` only when retaining
   partial output and already-completed side effects is acceptable. Approval
   responses remain separate and never steer.

## Consequences

The runtime and its mandatory AI SDK peer move together under an inspectable
lockfile. Exact pins trade automatic preview updates for explicit dependency
review, which is appropriate while Eve's public APIs are changing rapidly.

Old sessions lose transparent continuity across this cutover. Draining first
preserves work that can finish safely, while replacement avoids replaying a
0.22.5 continuation envelope through a runtime that no longer accepts that
contract. The operator must retain the old session identifier and terminal
reason as migration evidence rather than presenting a replacement session as a
resume.

The queue default for future Loopworks-authored stage delivery favors finishing
accepted durable work over low-latency replacement. A feature that deliberately
adopts steering must test cancellation boundaries, recursive subagent
cancellation, approval state, and idempotency of any side effects.

## Validation

1. The red-first dependency/runtime contract asserts the exact package and
   lockfile versions, this rationale, the session cutover, and the repo-local
   skill's fixed-session API guidance.
2. `bun test tests/unit/agent` covers agent discovery, guarded tools, sandbox
   definitions, instrumentation, and eval contracts on the selected runtime.
3. `bunx eve info --json` reports the root and declared siblings without
   discovery diagnostics, and `bunx eve eval --list` finds every authored eval.
4. Staging evidence must identify the deployment and selected Eve version, then
   cover a new session, a subagent handoff, cancellation and approval handling,
   and the old-session replacement. Fixture-only evidence does not satisfy this
   item.
5. `bun run validate` and `bun run build` pass before merge.

## Follow-Ups

1. Link the staging evidence from issue #181 and the implementing pull request.
2. Accept this ADR only after maintainer review of the migration and real
   staging evidence.
