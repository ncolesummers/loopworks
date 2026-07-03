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

Loopworks uses Bun. Run eve commands through `bunx eve ...`. If `eve` is not
installed yet in this project, add it with `bun add eve` or run `bun install`
against the committed lockfile, then read the bundled docs.
