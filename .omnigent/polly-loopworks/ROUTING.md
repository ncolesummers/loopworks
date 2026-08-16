# Polly LoopWorks Model Routing

This document is the public routing and cross-review contract for the
project-scoped `polly-loopworks` Omnigent bundle. Worker names encode model
tiers, so an orchestrator chooses a named role instead of remembering or
overriding a model string.

LoopWorks uses three subscriptions with independent meters: **OpenAI Pro 5x,
Anthropic $100, and Gemini $20**. OpenAI meters reasoning time rather than
messages, so routing optimizes for reasoning steps and output tokens. Spill
across providers instead of waiting for one allowance to reset.

## Verified harness availability

The aliases below were confirmed on the target machine on 2026-08-15.
Subscription logins expose no model-listing API, so this is a curated catalog,
not a live provider probe.

| Bundle workers | CLI | Status | Models |
| --- | --- | --- | --- |
| `sol`, `luna`, `terra`, `reviewer_sol` | `codex` | Available | `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.5` |
| `opus`, `reviewer_opus` | `claude` | Available | `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`, `claude-fable-5` |
| `gemini` | `agy` | Boots with Gemini 3.7 Flash (high); model enumeration unavailable | Harness default only |

The OpenAI and Anthropic legs are executable. The Gemini leg must pass a smoke
test before a workflow depends on it.

## Implementation tiers

### Default: `sol` (`gpt-5.6-sol`)

Use for substantive implementation: features, refactors, multi-file changes,
debugging, and tests. It averages roughly 61 reasoning steps and 60,000 output
tokens per task in the benchmark evidence behind this policy, about half the
burn of alternatives at equal or better accuracy. The expected allowance is
75–450 messages per five-hour window.

Do not use Sol for mechanical edits; route those to Luna.

### Volume: `luna` (`gpt-5.6-luna`)

Use for mechanical edits, renames, docstrings, type annotations, configuration,
changelogs, log reading, triage, verification, summarization, and parallel
fan-out. The expected allowance is 250–1,400 messages per five-hour window.
Using Luna freely protects the Sol allowance.

### Mid-tier: `terra` (`gpt-5.6-terra`)

Use for real work that is too heavy for Luna but does not require Sol. Terra is
the second OpenAI spill target, with an expected allowance of 100–550 messages
per five-hour window.

### Architecture and cross-provider spill: `opus` (`claude-opus-5`)

Use Opus when:

- Sol is throttled;
- Sol has failed twice on the same task;
- the work is architectural, ambiguous, or exploratory; or
- an adversarial perspective from the Anthropic provider is required.

Anthropic has a separate meter, so this is headroom relative to the OpenAI
pool. Opus burns roughly twice Sol's steps for a tied benchmark score. Do not
use it for bulk or fan-out work.

### Tiebreak only: `gemini` (harness default)

The `antigravity-native` harness enumerates no models, so this worker has no
`executor.model` pin. It currently runs Gemini 3.7 Flash by default. Use it
only when:

- both OpenAI and Anthropic are throttled;
- context exceeds what Sol or Opus can hold in one session; or
- Sol and Opus reviewers still disagree after one reconciliation round.

This is the smallest subscription tier and has the heaviest measured per-task
burn at roughly 125 steps. Until the harness passes a smoke test, escalate a
surviving reviewer disagreement to a human rather than Gemini.

## Prohibited routing

- Never select `claude-fable-5` for benchmark performance. It has a lower
  DeepSWE score than Opus 5 at equal token burn. It is allowed only as a
  deliberate safeguard or policy choice. The orchestrator's CEL guardrail
  denies a dispatch-time override, so choosing Fable requires an explicit,
  reviewable policy change.
- Never use Gemini 3.5 Flash or 3.6 Flash for coding work.
- Never use Sol for mechanical edits; use Luna.
- Never use Opus for bulk or fan-out work.
- Never assume the five-hour window is the only limit. Weekly caps and shared
  credit pools still apply.

## Dual adversarial cross-review

Every issue implementation receives two independent reviewers in fresh
contexts, regardless of diff size:

- **Reviewer A — `reviewer_sol`:** correctness, edge cases, test adequacy, and
  specification conformance.
- **Reviewer B — `reviewer_opus`:** architecture, blast radius, coupling, and
  implications for adjacent subsystems.

Both reviewers are mandatory and normally span vendors. Their worker configs
declare `sandbox: {}`, which resolves to the platform's read-only OS sandbox
(`darwin_seatbelt` on macOS or `linux_bwrap` on Linux) and fails loudly when
unavailable. The `read_only_os` tool guardrail adds a second layer, so reviewers
report findings and cannot edit the implementation.

### Review mechanics

1. Dispatch Reviewer A and Reviewer B in the same orchestrator turn so they run
   in parallel and neither can see the other's output.
2. Give each a file path. The file contains only the issue, acceptance
   criteria, test plan, and diff. Never paste a large multiline diff inline;
   native TUIs can drop it, especially the antigravity TUI.
3. Never let the authoring session review its own diff. If the author used Sol,
   Reviewer A is still a fresh `reviewer_sol` session with no author context.
4. The authoring worker reconciles deduplicated findings. The orchestrator
   never edits the diff.
5. Return the revised review-input file to both reviewers. Repeat until both
   have reviewed the final diff and every finding is fixed or deferred with a
   stated reason.
6. A disagreement that survives one author reconciliation round goes to
   `gemini` only after its smoke test. Before that, escalate it to a human.

The review pair satisfies Polly's cross-vendor requirement even when Reviewer A
shares the author's model lineage because the second reviewer is always on the
other provider and both contexts are fresh.

### Degraded fallback

If Sol is throttled, launch a fresh `reviewer_sol` context with an explicit
`gpt-5.6-terra` model fallback. If Opus is throttled, launch a second fresh
`reviewer_sol` context and assign it Reviewer B's architecture and blast-radius
focus. Both fallbacks retain the reviewer worker's read-only sandbox and
`read_only_os` guardrail. Never use the writable `sol` or `terra` implementer
config for review.

The `reviewer_sol` prompt treats architecture and blast radius as its focus
when it is explicitly dispatched as degraded Reviewer B. Two reviewers from
one provider are better than one reviewer, but they do not provide vendor
independence.

The orchestrator announces either fallback before dispatch. Terra Reviewer A
plus Opus Reviewer B still spans vendors and does not receive the degradation
stamp. The Opus-to-Sol fallback loses vendor independence, so the orchestrator
must stamp the PR body and handoff with
`reviewed without vendor independence`. It must never apply that fallback
silently. If two read-only reviewers cannot run, stop before handoff or
publication; review is never optional.

Custom `sys_session_create` launches are denied. The bundle keeps upstream's
spawn surface but routes execution only through declared workers, preventing a
custom config from bypassing the pinned roster or Fable policy.
