# GitHub Guide

## Scope

This guide applies to GitHub Actions workflows, issue templates, and repository
automation under `.github/`, plus GitHub review-thread operations performed
while maintaining pull requests.

## Rules

1. Keep CI aligned with local deterministic validation.
2. Prefer explicit workflow steps over hidden aggregate commands when CI output
   benefits from step-level failure visibility. Biome is the deliberate
   exception: it runs as one `bun run check` step because splitting it into
   `format:check` and `lint` drops assists such as import sorting entirely. Its
   diagnostics name their own rule, so step-level detail is not lost.
3. Issue templates should capture acceptance criteria and validation evidence.
4. Do not put secrets, tokens, private keys, or production credentials in
   workflows or templates.
5. Manage labels, milestones, and issues directly via `gh` or the GitHub UI;
   keep issue templates and this guide aligned with the label/milestone names
   actually in use.
6. To resolve an inline PR review comment through the GitHub API, query
   `pullRequest.reviewThreads` and resolve the review-thread node ID; the review
   comment database ID is not directly resolvable.
7. Preview deployments cannot exercise the GitHub installation or
   repository-selection surfaces on their own: those flows require the stable
   alias registered with the preview GitHub App. When a pull request changes
   them, label it `preview:alias` so `preview-alias.yml` repoints the alias at
   that pull request, then verify against the alias. Only one pull request can
   hold the alias at a time, and fork branches cannot use it. Procedure lives in
   `docs/runbooks/vercel-preview-verification.md`; the durable decision is
   ADR 0027.
