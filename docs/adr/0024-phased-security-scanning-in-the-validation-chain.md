# ADR 0024: Phased Security Scanning in the Validation Chain

Status: Proposed
Date: 2026-08-08
Issue: [#175](https://github.com/ncolesummers/loopworks/issues/175)
Updated by: [#177](https://github.com/ncolesummers/loopworks/issues/177),
[#184](https://github.com/ncolesummers/loopworks/issues/184)

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

**Current configuration after #177:**

| Scanner | Lane | Enforcement |
| --- | --- | --- |
| Gitleaks (working tree) | `validate` | Blocking |
| Gitleaks (committed history) | `ci-only` | Blocking |
| Curated Semgrep ruleset | `validate` | Blocking |
| OSV-Scanner | `validate` | Blocking |

**A missing binary is skipped locally and fails in CI.** This is the one
concession to the chain's uniformity, and it is narrow: it covers absence only,
it prints the install command so it cannot read as a pass, and
`LOOPWORKS_SECURITY_REQUIRE_SCANNERS=true` opts a developer into CI's behavior.

**The curated Semgrep ruleset stays small.** Five rules, each grounded in an
existing repository invariant and each verified against a positive and a
negative fixture before being added. Broad upstream rulesets and ZAP are a
separate advisory lane, deferred until their false-positive and runtime
baselines have been reviewed.

**Dependabot supplies update intake, not the security verdict.** Weekly Bun and
GitHub Actions version updates are configured in the repository, and repository
vulnerability alerts plus automated security fixes are enabled. GitHub does not
support Dependabot security updates for the Bun ecosystem, so OSV remains the
blocking source of truth. Routine non-major changes may be grouped; Eve,
Next.js, Auth.js, OpenTelemetry, and the Vercel OTel integration remain isolated
because their migrations require focused review.

**Dependabot lockfile repair uses a two-stage privilege boundary.** GitHub gives
Dependabot-authored `pull_request` and `pull_request_target` runs a read-only
token even when a job requests write access, and privileged PR-target workflows
must not execute PR code. A read-only `pull_request` workflow therefore runs
`bun install --ignore-scripts` and uploads only `bun.lock` plus immutable head
metadata. A default-branch `workflow_run` workflow validates that metadata,
rejects a stale head, and commits only `bun.lock` with job-scoped
`actions: write` and `contents: write`. It has one fixed shell step and no
third-party actions, never runs code from the PR checkout, and explicitly
dispatches CI because GitHub suppresses ordinary workflow events caused by its
repository token.

## Consequences

The pre-k → precommit → validate chain now reaches the scanners, so a secret
fails at commit time rather than at review time. Because `validate` gates are
mirrored one-to-one into CI and that mirroring is test-enforced, a scanner
cannot be quietly dropped from one side.

OSV became blocking in #177 after targeted parent upgrades, a Storybook adapter
migration, removal of the unused repository-local Vercel CLI, and six
same-major-safe overrides. Two Moderate findings without compatible fixes have
exact, documented exceptions expiring 2026-11-06. The two unpatched High
`image-size` defects are fixed with a Bun-managed repository patch and
timeout-bounded regression tests; exact OSV entries filter the unchanged
upstream version metadata. Tests require every entry's ID, reason, tracking
issue, expiry, and documentation row to agree.

Contributors now need three binaries for the full local gate. Without them the
run is still green but weaker, which is a real gap for anyone who never installs
them; CI is the backstop, and the skip message is loud.

Pinning means a scanner upgrade is a deliberate change touching the registry,
the CI install step, and the cache key together — more friction than a floating
tag, and the point.

Dependabot PRs from package-manager ecosystems that do not understand Bun no
longer stop at the frozen-lockfile install. The repair adds an extra workflow
run and artifact handoff, but preserves the read-only boundary of PR execution,
creates no empty commit when the generated lock is unchanged, and leaves the
normal frozen install as the gate that verifies the committed result.

## Validation

- `tests/unit/scripts/run-security-scanner.test.ts` — the enforcement policy as
  a pure decision table: all configured scanners are blocking, missing binary
  behavior remains explicit, and a synthetic advisory scanner still fails on a
  crash or timeout.
- `tests/unit/ci/security-scanning.test.ts` — scanner commands exist, are
  reached by `validate`, appear as unconditional CI steps, are installed at the
  pinned version with checksum verification, and no step anywhere is
  `continue-on-error`. Baseline hygiene is checked with control cases so it
  cannot pass vacuously.
- `tests/unit/ci/validation-chain.test.ts` — the prek hook still reaches
  `precommit`, which still delegates to `validate`, which still reaches the
  scanners.
- `tests/unit/ci/dependabot.test.ts` — the Bun and GitHub Actions schedules,
  grouping policy, and isolated runtime migrations remain explicit.
- `tests/unit/ci/dependabot-lockfile.test.ts` — the PR actor/repository guard,
  read-only generator, scripts-disabled install, immutable artifact binding,
  minimal privileged permissions, stale-head guard, and changed-only commit.
- All three scanners run against this repository at their pinned versions;
  Gitleaks (tree and history), Semgrep, and blocking OSV are clean after the
  exact expiring OSV exceptions are applied.

## Follow-ups

- [#177](https://github.com/ncolesummers/loopworks/issues/177) — completed the
  dependency remediation and blocking OSV transition.
- [#180](https://github.com/ncolesummers/loopworks/issues/180) — remove or
  re-review the four residual exceptions before 2026-11-06.
- Advisory broad-Semgrep and ZAP lanes, deferred from #175.
- Revisit whether the committed-history scan should move into `validate`; at
  205 commits it takes about 0.8s, so the CI-only split is currently a division
  of labour rather than a runtime constraint.

Refs ADR 0006.
