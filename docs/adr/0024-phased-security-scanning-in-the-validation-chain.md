# ADR 0024: Phased Security Scanning in the Validation Chain

Status: Proposed
Date: 2026-08-08
Issue: [#175](https://github.com/ncolesummers/loopworks/issues/175)

## Context

Loopworks had no automated security tooling: no dependency scanning, no secret
scanning, no static analysis, no Dependabot, no CodeQL. Every check in
`bun run validate` was correctness or style. #175 is the p0 that closes that gap
before the MVP security review (#16).

ADR 0006 established the shape of validation here: one chain, run identically by
a developer and by CI, with no gate that exists only in one place. Security
scanners strain that shape in ways the existing gates do not.

**They are external binaries.** Biome, TypeScript, and Vitest arrive with
`bun install`. Gitleaks, OSV-Scanner, and Semgrep do not — they are a Homebrew
formula and a Python tool. A chain that hard-requires them breaks
`bun run validate` for anyone who has not installed them yet, on a repository
where `validate` is also the commit hook.

**Their findings are not all actionable at the same rate.** The first
OSV-Scanner run reported 98 vulnerabilities across 25 packages, 6 Critical and
45 High — a pre-existing backlog, not a regression. Measured, a full
`bun update` plus a `next-auth` bump clears 24 and leaves 74, all transitive,
needing `overrides` or upstream releases. Gitleaks and a curated Semgrep ruleset
reached zero findings after triaging two true negatives.

So "turn on three scanners, block on all of them" was not available. The
choices were: block on everything and carry a 98-entry baseline; block on
everything and land a dependency rewrite inside a tooling change; or phase them.

## Decision

**Scanners run through repository-owned commands, one per scanner**, defined in
a typed registry in `scripts/run-security-scanner.ts`. The registry is the
single source of truth for versions, arguments, lanes, and enforcement; the
contract tests derive their expectations from it rather than restating them.

**Versions are pinned exactly, and a mismatch fails.** A scanner at the wrong
version is a present analyzer applying rules nobody reviewed. That is a
different failure from an absent one and does not get the absent one's leniency.

**Two independent axes, deliberately not conflated:**

- *Lane* — where a scanner runs. `validate` (the local chain and CI) or
  `ci-only`.
- *Enforcement* — what a **finding** does. `blocking` or `advisory`.

Enforcement lives in the runner, never as `continue-on-error` in the workflow.
`continue-on-error` cannot tell a finding from a crash: it would also swallow a
timeout, a partial result, and a missing binary. An advisory scanner here still
fails the build if it did not run. No step in `ci.yml` carries
`continue-on-error`, and a test asserts that across the whole file.

**Initial configuration:**

| Scanner | Lane | Enforcement |
| --- | --- | --- |
| Gitleaks (working tree) | `validate` | Blocking |
| Gitleaks (committed history) | `ci-only` | Blocking |
| Curated Semgrep ruleset | `validate` | Blocking |
| OSV-Scanner | `validate` | Advisory until [#177](https://github.com/ncolesummers/loopworks/issues/177) |

**A missing binary is skipped locally and fails in CI.** This is the one
concession to the chain's uniformity, and it is narrow: it covers absence only,
it prints the install command so it cannot read as a pass, and
`LOOPWORKS_SECURITY_REQUIRE_SCANNERS=true` opts a developer into CI's behavior.

**The curated Semgrep ruleset stays small.** Five rules, each grounded in an
existing repository invariant and each verified against a positive and a
negative fixture before being added. Broad upstream rulesets and ZAP are a
separate advisory lane, deferred until their false-positive and runtime
baselines have been reviewed.

## Consequences

The pre-k → precommit → validate chain now reaches the scanners, so a secret
fails at commit time rather than at review time. Because `validate` gates are
mirrored one-to-one into CI and that mirroring is test-enforced, a scanner
cannot be quietly dropped from one side.

Advisory OSV is an honest partial: the SCA half of #175 is wired, pinned, and
reporting, but is not yet a gate. The risk is that "temporary" becomes
permanent. Three things push against that: #177 carries the remediation as a
p0, the registry comment names it, and a unit test pins OSV as the *only*
advisory lane — so a second advisory scanner, or a silent flip, fails a test.

Contributors now need three binaries for the full local gate. Without them the
run is still green but weaker, which is a real gap for anyone who never installs
them; CI is the backstop, and the skip message is loud.

Pinning means a scanner upgrade is a deliberate change touching the registry,
the CI install step, and the cache key together — more friction than a floating
tag, and the point.

## Validation

- `tests/unit/scripts/run-security-scanner.test.ts` — the enforcement policy as
  a pure decision table: skip vs fail on a missing binary, fail on a version
  mismatch, advisory vs blocking findings, and fail on a crash or timeout for
  advisory scanners too.
- `tests/unit/ci/security-scanning.test.ts` — scanner commands exist, are
  reached by `validate`, appear as unconditional CI steps, are installed at the
  pinned version with checksum verification, and no step anywhere is
  `continue-on-error`. Baseline hygiene is checked with control cases so it
  cannot pass vacuously.
- `tests/unit/ci/validation-chain.test.ts` — the prek hook still reaches
  `precommit`, which still delegates to `validate`, which still reaches the
  scanners.
- All three scanners run against this repository at their pinned versions;
  Gitleaks (tree and history) and Semgrep are clean, OSV reports the backlog
  tracked in #177.

## Follow-ups

- [#177](https://github.com/ncolesummers/loopworks/issues/177) — clear the
  dependency backlog and flip OSV to blocking.
- Advisory broad-Semgrep and ZAP lanes, deferred from #175.
- Revisit whether the committed-history scan should move into `validate`; at
  205 commits it takes about 0.8s, so the CI-only split is currently a division
  of labour rather than a runtime constraint.

Refs ADR 0006.
