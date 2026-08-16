---
name: tdd-implement
description: Plan and implement a scoped LoopWorks change with a continuous tests-first red-to-green evidence chain. Use when an issue or finding needs code, configuration, tests, or documentation changes.
metadata:
  loopworks-skill-class: CRAFT
---

# TDD Implement

Read the issue, acceptance criteria, root guide, nearest scoped guides, and
relevant ADRs. Preserve unrelated user work.

Map every acceptance criterion to a deterministic unit, integration, browser,
or manual check. Include negative and boundary cases. State why any criterion
cannot be automated.

Write or update the focused tests before implementation. Run the exact focused
command and retain the failing assertion that proves the intended gap. A setup
failure or an earlier missing-file failure is not red evidence for assertions
that never executed.

Make the smallest production, configuration, or documentation change that
turns the expected failure green. Refactor only while the focused suite stays
green. Re-run affected checks after each material adjustment.

Return:

- the AC-to-test map;
- the exact red command, exit status, and failing assertion;
- the exact green command and exit status;
- changed files and material decisions;
- unresolved gaps; and
- the requested handoff packet with issue, ACs, test plan, evidence, and diff.
