# Codex Hooks

LoopWorks uses project-local Codex hooks from `.codex/hooks.json`.

Codex requires non-managed hooks to be reviewed and trusted before they run. Use
`/hooks` in Codex after changing this folder, review the command definitions,
and trust the updated hashes if they match the repository intent.

The hooks are intentionally lightweight:

- `UserPromptSubmit` prints the LoopWorks workflow checklist for
  implementation-like prompts.
- `PreToolUse` blocks generated-file edits and warns on unpaired component
  edits.
- `Stop` prints changed-file reminders for tests, docs, Storybook, agent-doc
  sync, status badges, safe external links, and explicit empty states.
- `SubagentStart` reminds agents to keep delegated work narrow and read-only
  unless write scopes are concrete and disjoint.

Do not add a parallel inline hook table in `.codex/config.toml`; keep one hook
representation per project layer.
