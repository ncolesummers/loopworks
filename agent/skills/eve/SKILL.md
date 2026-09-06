---
description: "Build durable backend AI agents with the eve framework. Use when creating, editing, or debugging an eve project — agent instructions, skills, tools, connections, channels, sandboxes, subagents, schedules, or evals."
---
# eve

eve is a filesystem-first framework for durable backend AI agents. An agent is
a directory on disk — instructions, skills, tools, connections, channels,
subagents, and schedules are all files — and eve compiles and runs it.

## Source of truth

The complete documentation ships inside the `eve` package. Do not rely on this
skill for guidance — always read the bundled docs, which match the installed
version exactly.

From the repository root:

```text
node_modules/eve/docs/
```

From this skill file:

```text
../../../node_modules/eve/docs/
```

Start with `node_modules/eve/docs/README.md` from the repository root. It
contains the full index and recommended reading order. Before writing any eve
code, read the relevant guide there first.

Loopworks uses Bun. Run eve commands through `bunx eve ...`. Restore the
committed dependency graph with `bun install`. If an issue-backed migration
changes the runtime pair, pin both packages exactly; the current contract is
`bun add --exact eve@0.51.0 ai@7.0.92`. Then update this skill and its contract
test before reading the newly installed bundled docs.

Translate upstream package-manager examples to the repository's Bun contract:

| Upstream example | Loopworks command |
| --- | --- |
| `npx eve ...` or `pnpm eve ...` | `bunx eve ...` |
| `npm install <packages>` | `bun add <packages>` |
| `npm run <script>` | `bun run <script>` |

## Session API contract

The installed Eve line uses fixed, ID-addressed sessions. Create sessions with
`client.sessions.create(input)` and recover a handle with
`client.sessions.attach(sessionId)`. Do not add continuation-token routing;
continuation tokens were removed from the public client and HTTP contracts.

Send ordinary turns with positional `send(message, options)`. Answer pending
human input separately with `respond(inputResponses, options)`. Message and
input-response delivery are intentionally distinct so approval responses cannot
be mistaken for ordinary user turns.

## Overlapping-turn contract

Message deliveries default to cancellation-backed `turnPolicy: "steer"`. A new
message can cancel an active turn and replace it under a new turn ID. Completed
side effects are not rolled back, so authored Loopworks channels and durable
stage sends must use `turnPolicy: "queue"` unless replacement is an explicit,
tested product behavior. `respond(inputResponses, options)` answers a pending
request and never steers; use explicit cancellation when work should stop
without a replacement message.

## Trace audience contract

Eve 0.44's provider pipeline is public-only by default.
Built-in channels classify their audience as `public`, `private`, or `unknown`,
and provider `otel()` uses that classification as its default head gate.
Loopworks currently uses the legacy single-file instrumentation layout with
`experimental.instrumentationProviders` disabled, so it does not apply the
provider pipeline's audience head gate. Do not describe `private` or `unknown`
traces as rejected by the current repository configuration.

Keep raw inputs and outputs behind Loopworks' existing telemetry opt-in. Before
adding a broader exporter, use a separately reviewed provider-layout migration
with audience tests, or configure and test an equivalent explicit destination
filter. Zero-configuration local tracing may retain unclassified HTTP and TUI
sessions when no authored instrumentation replaces it.

## Background task and HITL contract

Eve 0.51 runs every declared subagent as a durable background task without an
experimental flag. A delegation returns a `working` receipt; only the later
terminal notification carries the completed result. Delegate one stage at a
time and apply only that completed typed artifact. An admitted child survives
cancellation of its initiating turn; use `task_cancel` to stop it. Parent-session
finalization cancels remaining tasks. Test these boundaries before promotion.

Authored tools remain foreground unless explicitly configured for background
execution. `task.send` remains an in-process, non-restart-safe callback for
authored executors. Do not reintroduce `task_sleep`; parents wake through task
lifecycle notifications.

`glob` and `grep` are opt-in exports in this release, so leave their files absent
instead of exporting invalid `disableTool()` sentinels. Keep other dangerous
defaults disabled, including the root copy-agent tool; verify the compiled tool
surface rather than inferring permissions from filenames.

Keep human responses separate from ordinary messages. Pass exact response
literals to `respond(inputResponses, options)`, or values validated by
`parseInputResponses()`. A background child's HITL prompt is surfaced on its
parent session and routes back to the child without invoking the parent model.

Persistent subagent continuations forward the active caller rather than
inheriting previous authority. Upgrade both remote deployments before resuming
existing persistent sessions; an incompatible receiver must reject the
continuation instead of falling back to service authority.
