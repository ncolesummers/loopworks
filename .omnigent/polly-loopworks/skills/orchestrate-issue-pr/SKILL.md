---
name: orchestrate-issue-pr
description: Reserved LoopWorks workflow entrypoint; the workflow contract is deferred to issue 280 and is not available from the routing-only bundle.
---

# Orchestrate Issue PR

PR #268 does not implement an issue-to-PR workflow. The routing bundle blocks
this placeholder by both its bare name and its resolved plugin name,
`polly-loopworks:orchestrate-issue-pr`.

Review isolation, reconciliation and termination, orchestrator containment,
dispatch-envelope validation, ledger integrity, bootstrap gating, and
publication sequencing belong to
[issue #280](https://github.com/ncolesummers/loopworks/issues/280).
