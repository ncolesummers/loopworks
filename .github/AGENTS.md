# GitHub Guide

## Scope

This guide applies to GitHub Actions workflows, issue templates, and repository
automation under `.github/`, plus GitHub review-thread operations performed
while maintaining pull requests.

## Rules

1. Keep CI aligned with local deterministic validation.
2. Prefer explicit workflow steps over hidden aggregate commands when CI output
   benefits from step-level failure visibility.
3. Issue templates should capture acceptance criteria and validation evidence.
4. Do not put secrets, tokens, private keys, or production credentials in
   workflows or templates.
5. Update `scripts/bootstrap-github.ts` when foundational labels, milestones,
   issues, or project setup change.
6. To resolve an inline PR review comment through the GitHub API, query
   `pullRequest.reviewThreads` and resolve the review-thread node ID; the review
   comment database ID is not directly resolvable.
