---
name: browser-validate
description: Validate a user-visible LoopWorks change in a real browser across primary, negative, responsive, accessibility, console, and network cases.
---

# Browser Validate

Start the application with the repository-supported command and use the
`agent-browser` skill against the running URL.

Exercise the primary journey and at least one meaningful negative path. Check
the relevant narrow and wide viewports, keyboard operation, focus behavior,
accessible names, and visible error states. Inspect browser console and failed
network requests throughout.

Capture screenshots of meaningful states to a temporary path. Do not commit
screenshots. Report the exact commands, URL, cases, pass/fail result, screenshot
paths, console or network failures, and coverage gaps. If browser validation is
not applicable, state the concrete reason.
