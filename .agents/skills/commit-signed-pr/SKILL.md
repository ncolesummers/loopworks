---
name: commit-signed-pr
description: Publish an already validated LoopWorks change as a signed contributor-authored commit and draft pull request with local and GitHub provenance evidence.
metadata:
  loopworks-skill-class: CRAFT
---

# Commit Signed PR

Confirm the working tree contains only the authorized issue scope and that all
required validation is green.

Run `bun run commit:preflight` and retain its complete output. Stop if the
effective author or committer is malformed, reserved, or not configured for
signing. Never substitute another identity.

Create the smallest appropriate Conventional Commit with `git commit -S`.
Never bypass hooks. Verify it locally with `git verify-commit <commit>` or
`git log --show-signature -1` and retain the output.

Fill the repository pull-request template in a file, including
`Closes #<issue>` and the AC-to-evidence table. Push only the issue branch and
create or update a draft pull request. Never mark ready, force-push, push a
protected branch, or merge.

After pushing, obtain credentials without printing the token:

```bash
export GH_TOKEN="$(gh auth token)"
export GITHUB_REPOSITORY="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
bun run commit:provenance --github <PR>
```

Stop on any GitHub-resolved author or signature mismatch. Return the branch,
commit, draft PR URL, complete preflight output, local signature result, push
status, and GitHub provenance result.
