# ADR 0026: GitHub-Bound Signed Commit Provenance

Status: Proposed
Date: 2026-08-08
Issue: [#209 — Enforce GitHub-bound signed commit provenance](https://github.com/ncolesummers/loopworks/issues/209)

## Context

A test fixture previously wrote `Test <test@example.com>` into shared Git
configuration. The identity persisted into published commits, and directly
created commits were not consistently signed. A fixed maintainer email would
prevent legitimate contributors from working, while email linkage alone is
not authoritative: fixture addresses can be ambiguous across GitHub API
surfaces.

The repository needs a contributor-safe contract that works for human
contributors, GitHub web operations, and Dependabot without rewriting
published `main` history.

## Decision

GitHub's post-push commit metadata is authoritative. The repository-owned
validator requires every introduced commit to have:

- a GitHub-resolved primary author (`author.user`);
- a valid, verified signature (`signature.isValid`, valid state, and a resolved
  signer); and
- a non-reserved author, committer, and `Co-authored-by` email address.

For a signature not created by GitHub, the resolved signer must match the
resolved author or committer. GitHub-signed `web-flow` commits and bot commits
are accepted when the primary author resolves to a GitHub account. This keeps
the policy contributor-safe without trusting an email string by itself.

Local publication uses effective, read-only Git inspection. The preflight
rejects malformed identities, IANA special-use fixture domains (including
subdomains and case variants), and disabled default signing. Authorized local
commits use `git commit -S`; agents preserve the actual contributor identity
represented and never create or write fixture identities.

Enforcement has four layers:

1. `AGENTS.md` and the `implement-issue` skill define the authorization,
   signing, evidence, and stop conditions.
2. `commit:preflight` runs before the repository validation chain locally.
3. The trusted-base `commit-provenance` workflow runs
   `commit:provenance --github <PR>` with read-only GitHub metadata access for
   every PR validation and bound workflow dispatch, publishing the fixed
   `commit-provenance` status on the exact PR head.
4. After the signing-key and migration prerequisites are complete, an explicit
   GitHub `required_signatures` ruleset will enforce verified signatures at the
   default branch. It will have no routine bypass actor.

The Dependabot lockfile repair keeps PR-controlled work in the unprivileged
generator. The privileged workflow transfers only validated inert lockfile
data and immutable head/PR metadata, then calls GitHub's
[`createCommitOnBranch` mutation](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch)
with `expectedHeadOid` and base64 file contents. It does not provide author or
committer fields. GitHub automatically signs commits created by this mutation
when supported, so the repair remains compatible with required signatures. See
the [official commit-signature verification documentation](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).

The repository permits merge commits and squash merges. GitHub rebase-and-merge
is disallowed because GitHub documents that it creates new commits without
commit signature verification; see [signature verification for rebase and merge](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-rebase-and-merge).

## Consequences

Contributors use their own GitHub-linked identities and verified signing keys;
no owner-specific email allowlist is needed. GitHub web-flow and bot commits
remain usable without pretending that their signer is the human contributor.
Local publication has an additional preflight and evidence step, and a commit
cannot be rescued by disabling hooks or signing.

Existing published history is immutable under this decision. The known
fixture-identity commits on `main` are documented as historical provenance
debt. PR #202 has merged, so its two fixture-identity commits are historical
debt as well and are not an actionable rewrite target. Do not rewrite published history;
no force-rewrite of published `main` is permitted.

Merge and squash strategies preserve a verified merge commit or squash commit
under GitHub's supported signing behavior. Rebase-and-merge remains disabled
until a future policy can establish equivalent signature verification.

## Validation

- Unit tests cover reserved domains, local identity/signing preflight, resolved
  author and signer requirements, signer matching, GitHub web-flow and bot
  commits, co-author trailers, and GraphQL pagination.
- CI contract tests verify trusted-base ref selection, PR/head binding,
  read-only checkout, status publication, and the repository-owned provenance
  command.
- The Dependabot workflow tests verify inert artifact transfer, positive and
  workflow-run-bound PR numbers, expected-head mutation, base64 file contents,
  and the absence of local config/commit/push operations.
- Before enabling the branch ruleset, run the full validation chain and inspect
  a real PR's GraphQL provenance output without exposing its token.
- After this PR merges and with explicit authorization, disable rebase-and-merge
  and require the fixed `commit-provenance` status context together with
  `required_signatures` on the default branch.

## Follow-Ups

- Configure an approved signing key for each publishing contributor; do not
  generate or upload credentials silently.
- After this PR merges and with explicit authorization, disable rebase-and-merge
  and enable the default-branch `required_signatures` rule together with the
  fixed `commit-provenance` status context.
- Treat the merged PR #202 commits as historical provenance debt; do not rewrite
  published `main` history.
