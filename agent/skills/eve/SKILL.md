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
`bun add --exact eve@0.33.2 ai@7.0.58`. Then update this skill and its contract
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
